// What each player is allowed to see.
//
// This is the security boundary of the whole online game. The server holds the
// full state — including all four hands — and every message to a client passes
// through `viewFor`, which is the only function permitted to read
// `game.hands`. A client therefore cannot learn another player's tiles by
// inspecting network traffic, because those tiles are never sent.
//
// Everything else exposed here is information a player at a real table already
// has: how many tiles each opponent holds, what has been played, and which
// numbers each player has proved they cannot play by passing.

import { ends, legalMoves } from '../src/engine/game.js';

function tileOut(tile) {
  return { id: tile.id, high: tile.high, low: tile.low };
}

/**
 * A bot's reasoning describes its own hand ("3 more tiles sit in hand"), so it
 * cannot be sent while the hand is live without leaking that hand. It is held
 * back until the hand is over, which is when the review reads it anyway.
 */
function logFor(room, revealReasoning) {
  if (revealReasoning) return room.log;
  return room.log.map(({ explanation, ...entry }) =>
    explanation ? { ...entry, wasBot: true } : entry,
  );
}

/**
 * The state as `seat` is entitled to see it. Anything that is not a real seat —
 * `null`, or the -1 that an unrecognized token resolves to — gets the spectator
 * view, which reveals no hand at all.
 */
export function viewFor(room, seat) {
  const game = room.game;
  const seated = Number.isInteger(seat) && seat >= 0 && seat < room.seats.length;

  const base = {
    code: room.code,
    seat,
    status: room.status,
    hostSeat: room.hostSeat,
    players: room.seats.map((player, index) => ({
      seat: index,
      name: player.name,
      kind: player.kind,
      connected: player.kind === 'bot' ? true : player.connected,
      tiles: game ? game.hands[index].length : 0,
      // A pass is public at a real table; so it is here.
      voids: game ? [...game.knownVoids[index]].sort((a, b) => a - b) : [],
    })),
    log: logFor(room, Boolean(game) && game.phase !== 'playing'),
    message: room.message,
  };

  if (!game) {
    return { ...base, phase: 'lobby' };
  }

  const open = ends(game);

  return {
    ...base,
    phase: game.phase,
    handNumber: game.handNumber,
    scores: game.scores,
    targetScore: game.targetScore,
    turn: game.turn,
    starter: game.starter,
    line: game.line.map((placed) => ({
      id: placed.tile.id,
      a: placed.a,
      b: placed.b,
      double: placed.tile.high === placed.tile.low,
    })),
    ends: open,
    handResult: game.handResult,
    // The only hand ever serialized is the recipient's own.
    hand: seated ? game.hands[seat].map(tileOut) : [],
    legalMoves: seated ? legalMoves(game, seat) : [],
  };
}
