// Rebuilding a finished hand, one move at a time.
//
// The hand is replayed through the same engine that played it, from the tiles
// as they were dealt, so a frame is not a reconstruction that might disagree
// with what happened — it is the position the engine was actually in.
//
// Frames are computed once when review opens and then indexed by a cursor the
// server owns, which is what keeps every player looking at the same thing.

import { createGame, play, pass } from '../src/engine/game.js';

function frameOf(game, move) {
  return {
    line: game.line.map((placed) => ({
      id: placed.tile.id,
      a: placed.a,
      b: placed.b,
      double: placed.tile.high === placed.tile.low,
    })),
    // Every hand, face up. Review only ever opens on a finished hand, so there
    // is nothing left to give away.
    hands: game.hands.map((hand) =>
      hand.map((tile) => ({ id: tile.id, high: tile.high, low: tile.low })),
    ),
    move,
  };
}

/**
 * One frame per position, starting with the deal: `frames[0]` is the table
 * before anybody played, and `frames[n]` is the table after the nth move.
 */
export function buildFrames({ startingHands, starter, openingTileId, log }) {
  const game = createGame();
  game.hands = startingHands.map((hand) => hand.slice());
  game.starter = starter;
  game.turn = starter;
  game.openingTileId = openingTileId;
  game.line = [];
  game.handNumber = 1;
  game.phase = 'playing';

  const frames = [frameOf(game, null)];

  for (const entry of log) {
    // A move the engine refuses would mean the log and the deal disagree, which
    // is a bug worth hearing about rather than papering over with a half-built
    // replay.
    if (entry.type === 'pass') pass(game, entry.seat);
    else play(game, entry.seat, entry.tileId, entry.end);

    frames.push(
      frameOf(game, {
        seat: entry.seat,
        type: entry.type,
        tileId: entry.tileId ?? null,
        end: entry.end ?? null,
        ends: entry.ends ?? null,
        explanation: entry.explanation ?? null,
      }),
    );
  }

  return frames;
}
