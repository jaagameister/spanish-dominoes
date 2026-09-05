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
  DEFAULT_TARGET,
} from '../src/engine/game.js';
import { explainChoice } from '../src/engine/bot.js';
import { viewFor } from './protocol.js';

const SEATS = 4;
const BOT_PAUSE_MS = 1100;
const FORCED_PASS_PAUSE_MS = 900;
/** How long the table lingers on a finished hand before dealing the next. */
const HAND_REVIEW_MS = 20000;
/** Rooms with nobody connected are collected after this long. */
const ROOM_TTL_MS = 60 * 60 * 1000;

// No vowels (avoids accidental words) and no 0/O/1/I confusion.
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';

const rooms = new Map();

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
  };
  rooms.set(room.code, room);

  const token = seatPlayer(room, 0, name);
  return { room, token, seat: 0 };
}

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

function seatPlayer(room, seat, name) {
  const token = randomUUID();
  room.seats[seat] = {
    kind: 'human',
    name: name || `Player ${seat + 1}`,
    token,
    connected: false,
    difficulty: 1,
  };
  return token;
}

/** Seats alternate between the teams, so partners always sit across. */
export function joinRoom(code, name) {
  const room = getRoom(code);
  if (!room) return { error: 'No table with that code.' };
  if (room.status !== 'lobby') return { error: 'That game has already started.' };

  const seat = room.seats.findIndex((player) => player.kind === 'empty');
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

function dealHand(room) {
  startHand(room.game);
  room.log = [];
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
  afterMove(room, result);
}

function applyPass(room, seat) {
  const game = room.game;
  const open = game.line.length
    ? [game.line[0].a, game.line[game.line.length - 1].b]
    : null;
  room.log.push({ seat, type: 'pass', ends: open });
  const result = pass(game, seat);
  room.message = `${room.seats[seat].name} passed.`;
  afterMove(room, result);
}

function afterMove(room, result) {
  broadcast(room);

  if (room.game.phase === 'playing') {
    scheduleTurn(room);
    return;
  }

  if (room.game.phase === 'gameOver') {
    room.status = 'finished';
    broadcast(room);
    return;
  }

  // Hand over: leave it on screen long enough to review, then deal again.
  clearTimeout(room.timer);
  room.timer = setTimeout(() => dealHand(room), HAND_REVIEW_MS);
}

/** Drive bot turns, and auto-pass for anyone with no legal tile. */
function scheduleTurn(room) {
  clearTimeout(room.timer);
  const game = room.game;
  if (!game || game.phase !== 'playing') return;

  const seat = game.turn;
  const player = room.seats[seat];

  if (legalMoves(game, seat).length === 0) {
    // Passing is compulsory, so the server does it rather than waiting on a
    // client that has no choice to make.
    room.timer = setTimeout(() => applyPass(room, seat), FORCED_PASS_PAUSE_MS);
    return;
  }

  if (player.kind !== 'bot') return;

  room.timer = setTimeout(() => {
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

export function subscribe(room, seat, res) {
  const subscriber = { seat, res };
  room.subscribers.add(subscriber);

  if (seat >= 0 && room.seats[seat].kind === 'human') {
    room.seats[seat].connected = true;
  }

  send(subscriber, viewFor(room, seat));
  broadcast(room);

  return () => {
    room.subscribers.delete(subscriber);
    if (seat >= 0 && room.seats[seat].kind === 'human') {
      const stillHere = [...room.subscribers].some((s) => s.seat === seat);
      room.seats[seat].connected = stillHere;
    }
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
    send(subscriber, viewFor(room, subscriber.seat));
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
