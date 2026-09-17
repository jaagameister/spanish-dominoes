// Rooms: the server-authoritative game.
//
// The server owns the deal and applies every move itself. A client asks to play
// a tile; the engine decides whether that is legal. Nothing a client sends is
// trusted beyond "this token wants to make this move", so a tampered client can
// cheat no more than it could shout a wrong move at a real table.

import { randomUUID } from 'node:crypto';
import {
  createGame,
  startHand,
  legalMoves,
  play,
  pass,
  partnerOf,
  DEFAULT_TARGET,
} from '../src/engine/game.js';
import { explainChoice } from '../src/engine/bot.js';
import { viewFor } from './protocol.js';

const SEATS = 4;
const BOT_PAUSE_MS = 1100;
const FORCED_PASS_PAUSE_MS = 900;
/** How long the table lingers on a finished hand before dealing the next. */
const HAND_REVIEW_MS = 20000;
/**
 * A player whose partner is a bot gets to see what that partner did before play
 * moves on. If they wander off, the table resumes on its own rather than
 * stranding everyone else.
 */
const PARTNER_PAUSE_TIMEOUT_MS = 90000;
/** Rooms with nobody connected are collected after this long. */
const ROOM_TTL_MS = 60 * 60 * 1000;

// No vowels (avoids accidental words) and no 0/O/1/I confusion.
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';

const rooms = new Map();

/**
 * A scheduled turn should never be the reason the process stays alive — the
 * listening socket is. Unreferencing lets a test process exit once it stops
 * serving, instead of being held open by tables still dealing to bots.
 */
function later(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
}

function makeCode() {
  let code;
  do {
    code = Array.from(
      { length: 4 },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join('');
  } while (rooms.has(code));
  return code;
}

function emptySeat() {
  return { kind: 'empty', name: null, token: null, connected: false, difficulty: 1 };
}

export function createRoom(name) {
  const room = {
    code: makeCode(),
    createdAt: Date.now(),
    seats: Array.from({ length: SEATS }, emptySeat),
    hostSeat: 0,
    status: 'lobby',
    game: null,
    log: [],
    message: 'Waiting for players.',
    subscribers: new Set(),
    timer: null,
    pause: null,
  };
  rooms.set(room.code, room);

  const token = seatPlayer(room, 0, name);
  return { room, token, seat: 0 };
}

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

/**
 * Names are optional. Whatever arrives is trimmed and capped; anything that
 * leaves nothing behind falls back to the seat number, so no one ever shows up
 * at the table as a blank space.
 */
function cleanName(name, seat) {
  const trimmed = String(name ?? '')
    .trim()
    .slice(0, 16);
  return trimmed || `Player ${seat + 1}`;
}

function seatPlayer(room, seat, name) {
  const token = randomUUID();
  room.seats[seat] = {
    kind: 'human',
    name: cleanName(name, seat),
    token,
    connected: false,
    difficulty: 1,
  };
  return token;
}

/**
 * Where a newcomer sits. Seats alternate between the teams, so the naive
 * "next free seat" would make the second person at the table an opponent.
 * People arriving together almost always want to play together, so the second
 * human is seated *across* from the first. The host can rearrange anyone before
 * the game starts.
 */
function seatForNewcomer(room) {
  const humans = room.seats.filter((player) => player.kind === 'human');

  if (humans.length === 1) {
    const seated = room.seats.findIndex((player) => player.kind === 'human');
    const across = partnerOf(seated);
    if (room.seats[across].kind === 'empty') return across;
  }
  return room.seats.findIndex((player) => player.kind === 'empty');
}

export function joinRoom(code, name) {
  const room = getRoom(code);
  if (!room) return { error: 'No table with that code.' };
  if (room.status !== 'lobby') return { error: 'That game has already started.' };

  const seat = seatForNewcomer(room);
  if (seat === -1) return { error: 'That table is full.' };

  const token = seatPlayer(room, seat, name);
  room.message = `${room.seats[seat].name} sat down.`;
  broadcast(room);
  return { room, token, seat };
}

export function seatOf(room, token) {
  return room.seats.findIndex(
    (player) => player.kind === 'human' && player.token === token,
  );
}

/** Start play, filling any empty seats with bots. */
export function startGame(room, seat) {
  if (seat !== room.hostSeat) return { error: 'Only the host can start the game.' };
  if (room.status !== 'lobby') return { error: 'Already started.' };

  room.seats = room.seats.map((player, index) =>
    player.kind === 'empty'
      ? { kind: 'bot', name: `Bot ${index + 1}`, token: null, connected: true, difficulty: 1 }
      : player,
  );

  room.game = createGame({ targetScore: DEFAULT_TARGET });
  room.status = 'playing';
  dealHand(room);
  return { ok: true };
}

/** A player's display name is theirs to change, at any point. */
export function rename(room, seat, name) {
  const player = room.seats[seat];
  if (!player || player.kind !== 'human') return { error: 'No seat to rename.' };

  player.name = cleanName(name, seat);
  broadcast(room);
  return { ok: true };
}

/**
 * Swap two seats. The host arranges the table before the game starts — who
 * partners whom is the only thing seating decides, and it matters enough to be
 * worth choosing rather than inheriting from arrival order.
 */
export function arrange(room, seat, from, to) {
  if (seat !== room.hostSeat) return { error: 'Only the host can move players.' };
  if (room.status !== 'lobby') return { error: 'The game has already started.' };

  const valid = (s) => Number.isInteger(s) && s >= 0 && s < SEATS;
  if (!valid(from) || !valid(to)) return { error: 'No such seat.' };
  if (from === to) return { ok: true };

  // The host is identified by their token, not their chair, so hosting follows
  // them if they move themselves.
  const hostToken = room.seats[room.hostSeat].token;
  [room.seats[from], room.seats[to]] = [room.seats[to], room.seats[from]];
  room.hostSeat = room.seats.findIndex((player) => player.token === hostToken);

  room.message = 'The host rearranged the table.';
  broadcast(room);
  return { ok: true };
}

function dealHand(room) {
  startHand(room.game);
  room.log = [];
  room.pause = null;
  const opener = room.seats[room.game.starter].name;
  room.message =
    room.game.handNumber === 1
      ? `${opener} holds the double-six and must open with it.`
      : `${opener} opens this hand.`;
  broadcast(room);
  scheduleTurn(room);
}

/**
 * Apply a move. Every action funnels through here, and the engine is the only
 * arbiter of legality.
 */
export function act(room, seat, action) {
  const game = room.game;
  if (!game || game.phase !== 'playing') return { error: 'Not in play.' };
  if (room.pause) return { error: 'Waiting on a partner to catch up.' };
  if (game.turn !== seat) return { error: 'Not your turn.' };

  try {
    if (action.type === 'pass') {
      applyPass(room, seat);
    } else if (action.type === 'play') {
      applyPlay(room, seat, action.tileId, action.end, null);
    } else {
      return { error: 'Unknown action.' };
    }
  } catch (error) {
    return { error: error.message };
  }

  return { ok: true };
}

function applyPlay(room, seat, tileId, end, explanation) {
  room.log.push({ seat, type: 'play', tileId, end, explanation });
  const result = play(room.game, seat, tileId, end);
  room.message = `${room.seats[seat].name} played ${tileId}.`;
  afterMove(room, result, seat);
}

function applyPass(room, seat) {
  const game = room.game;
  const open = game.line.length
    ? [game.line[0].a, game.line[game.line.length - 1].b]
    : null;
  room.log.push({ seat, type: 'pass', ends: open });
  const result = pass(game, seat);
  room.message = `${room.seats[seat].name} passed.`;
  afterMove(room, result, seat);
}

/**
 * Hold the table after a bot plays, so the human it is partnering can see what
 * their partner did before the next three moves bury it. Returns whether the
 * table is now waiting.
 */
function maybePauseForPartner(room, moverSeat) {
  if (room.seats[moverSeat].kind !== 'bot') return false;

  const partnerSeat = partnerOf(moverSeat);
  const partner = room.seats[partnerSeat];
  if (partner.kind !== 'human' || !partner.connected) return false;

  room.pause = { seat: partnerSeat, by: moverSeat };
  broadcast(room);

  clearTimeout(room.timer);
  room.timer = later(() => resume(room), PARTNER_PAUSE_TIMEOUT_MS);
  return true;
}

function resume(room) {
  if (!room.pause) return;
  room.pause = null;
  broadcast(room);
  scheduleTurn(room);
}

/** The waiting player acknowledges their partner's move. */
export function proceed(room, seat) {
  if (!room.pause) return { error: 'Nothing to acknowledge.' };
  if (room.pause.seat !== seat) return { error: 'That is not your table to resume.' };
  resume(room);
  return { ok: true };
}

function afterMove(room, result, moverSeat) {
  broadcast(room);

  if (room.game.phase === 'playing') {
    if (!maybePauseForPartner(room, moverSeat)) scheduleTurn(room);
    return;
  }

  room.pause = null;

  if (room.game.phase === 'gameOver') {
    room.status = 'finished';
    broadcast(room);
    return;
  }

  // Hand over: leave it on screen long enough to review, then deal again.
  clearTimeout(room.timer);
  room.timer = later(() => dealHand(room), HAND_REVIEW_MS);
}

/** Drive bot turns, and auto-pass for anyone with no legal tile. */
function scheduleTurn(room) {
  clearTimeout(room.timer);
  const game = room.game;
  if (!game || game.phase !== 'playing') return;
  if (room.pause) return; // held until the waiting player says go

  const seat = game.turn;
  const player = room.seats[seat];

  if (legalMoves(game, seat).length === 0) {
    // Passing is compulsory, so the server does it rather than waiting on a
    // client that has no choice to make.
    room.timer = later(() => applyPass(room, seat), FORCED_PASS_PAUSE_MS);
    return;
  }

  if (player.kind !== 'bot') return;

  room.timer = later(() => {
    const choice = explainChoice(game, seat, { difficulty: player.difficulty });
    if (choice) {
      applyPlay(room, seat, choice.move.tileId, choice.move.end, choice);
    } else {
      applyPass(room, seat);
    }
  }, BOT_PAUSE_MS);
}

/** Skip the post-hand pause. */
export function ready(room, seat) {
  if (!room.game || room.game.phase !== 'handOver') return { error: 'Nothing to skip.' };
  clearTimeout(room.timer);
  dealHand(room);
  return { ok: true };
}

// --------------------------------------------------------------- streaming

function setConnected(room, token, connected) {
  const seat = seatOf(room, token);
  if (seat >= 0) room.seats[seat].connected = connected;
}

/**
 * A subscriber is identified by its token, never by a seat number. Seats move —
 * the host can rearrange the table — and a cached seat would go stale the
 * moment they did, which means sending a player the hand of whoever now sits
 * where they used to.
 */
export function subscribe(room, token, res) {
  const subscriber = { token, res };
  room.subscribers.add(subscriber);

  setConnected(room, token, true);
  send(subscriber, viewFor(room, seatOf(room, token)));
  broadcast(room);

  return () => {
    room.subscribers.delete(subscriber);
    const stillHere = [...room.subscribers].some((s) => s.token === token);
    setConnected(room, token, stillHere);
    broadcast(room);
  };
}

function send(subscriber, view) {
  try {
    subscriber.res.write(`data: ${JSON.stringify(view)}\n\n`);
  } catch {
    // The client vanished; the disconnect handler will clean it up.
  }
}

export function broadcast(room) {
  for (const subscriber of room.subscribers) {
    send(subscriber, viewFor(room, seatOf(room, subscriber.token)));
  }
}

export function heartbeat() {
  for (const room of rooms.values()) {
    for (const subscriber of room.subscribers) {
      try {
        subscriber.res.write(': ping\n\n');
      } catch {
        room.subscribers.delete(subscriber);
      }
    }
  }
}

export function collectIdleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idle = room.subscribers.size === 0 && now - room.createdAt > ROOM_TTL_MS;
    if (idle) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}
