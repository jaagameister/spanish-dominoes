// Engine tests. No dependencies and no test runner — `tests.html` imports this
// and renders the results, which keeps the project installable-free.

import { fullSet, makeTile, totalPips, otherEnd, hasValue } from './tiles.js';
import {
  createGame,
  startHand,
  legalMoves,
  play,
  pass,
  ends,
  canPlay,
  teamOf,
  partnerOf,
  nextSeat,
  OPENING_TILE_ID,
} from './game.js';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

function eq(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} expected ${expected}, got ${actual}`.trim());
  }
}

function throws(fn, message = 'expected a throw') {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

/** Build tiles from ids like `"6-4"`. */
function tiles(...ids) {
  return ids.map((id) => makeTile(...id.split('-').map(Number)));
}

/**
 * A game mid-hand with hands and layout set explicitly, so tests never depend
 * on the shuffle.
 */
function scenario({ hands, turn = 0, line = [], openingTileId = null }) {
  const state = createGame();
  state.hands = hands.map((ids) => tiles(...ids));
  state.line = line.map(([a, b]) => ({ tile: makeTile(a, b), a, b }));
  state.turn = turn;
  state.starter = turn;
  state.openingTileId = openingTileId;
  state.handNumber = 1;
  state.phase = 'playing';
  return state;
}

// ---------------------------------------------------------------- tiles

test('a double-6 set is 28 unique tiles totalling 168 pips', () => {
  const set = fullSet();
  eq(set.length, 28, 'tile count:');
  eq(new Set(set.map((t) => t.id)).size, 28, 'unique ids:');
  eq(totalPips(set), 168, 'total pips:');
});

test('each number appears on exactly 7 tiles', () => {
  const set = fullSet();
  for (let n = 0; n <= 6; n++) {
    eq(set.filter((t) => hasValue(t, n)).length, 7, `tiles bearing ${n}:`);
  }
});

test('otherEnd returns the opposite face, and doubles return themselves', () => {
  eq(otherEnd(makeTile(6, 4), 6), 4);
  eq(otherEnd(makeTile(6, 4), 4), 6);
  eq(otherEnd(makeTile(3, 3), 3), 3);
});

// ------------------------------------------------------------- seating

test('partners face each other and turns run to the left', () => {
  eq(teamOf(0), teamOf(2), 'seats 0 and 2 share a team:');
  eq(teamOf(1), teamOf(3), 'seats 1 and 3 share a team:');
  assert(teamOf(0) !== teamOf(1), 'adjacent seats are opponents');
  eq(partnerOf(1), 3);
  eq(nextSeat(3), 0);
});

// ------------------------------------------------------------- opening

test('the first hand is opened by the holder of the double-six, with it', () => {
  const state = createGame();
  startHand(state);

  const opener = state.starter;
  assert(
    state.hands[opener].some((t) => t.id === OPENING_TILE_ID),
    'the opener holds the double-six',
  );
  const moves = legalMoves(state, opener);
  eq(moves.length, 1, 'only one legal opening:');
  eq(moves[0].tileId, OPENING_TILE_ID);
});

test('later hands open one seat to the left with any tile', () => {
  const state = createGame();
  startHand(state);
  const first = state.starter;

  state.phase = 'handOver';
  startHand(state);

  eq(state.starter, nextSeat(first), 'opening moved one seat left:');
  eq(state.openingTileId, null, 'no forced opening tile:');
  eq(legalMoves(state, state.starter).length, 7, 'every tile is legal:');
});

test('opening the double-six leaves both ends showing six', () => {
  const state = scenario({
    hands: [['6-6', '4-2'], ['5-1'], ['3-0'], ['2-2']],
    openingTileId: '6-6',
  });
  play(state, 0, '6-6', 'open');
  const open = ends(state);
  eq(open.left, 6, 'left end:');
  eq(open.right, 6, 'right end:');
});

// --------------------------------------------------------- legal moves

test('a tile matching both ends offers a choice of end', () => {
  const state = scenario({
    hands: [['5-3'], [], [], []],
    line: [[5, 3]],
  });
  const moves = legalMoves(state, 0);
  eq(moves.length, 2, 'both ends playable:');
  assert(moves.some((m) => m.end === 'left'), 'left offered');
  assert(moves.some((m) => m.end === 'right'), 'right offered');
});

test('tiles matching neither end are not legal', () => {
  const state = scenario({
    hands: [['6-6', '4-1'], [], [], []],
    line: [[5, 3]],
  });
  eq(legalMoves(state, 0).length, 0, 'no legal moves:');
  eq(canPlay(state, 0), false);
});

test('playing on each end extends the line correctly', () => {
  const state = scenario({
    hands: [['5-2', '3-1'], [], [], []],
    line: [[5, 3]],
  });
  play(state, 0, '5-2', 'left');
  eq(ends(state).left, 2, 'new left end:');
  eq(ends(state).right, 3, 'right end unchanged:');

  state.turn = 0;
  play(state, 0, '3-1', 'right');
  eq(ends(state).right, 1, 'new right end:');
  eq(state.line.length, 3, 'line length:');
});

test('a player cannot play out of turn or play an illegal tile', () => {
  const state = scenario({
    hands: [['5-2'], ['6-6'], [], []],
    line: [[5, 3]],
  });
  throws(() => play(state, 1, '6-6', 'left'), 'out of turn rejected');
  throws(() => play(state, 0, '5-2', 'right'), 'wrong end rejected');
});

// -------------------------------------------------------------- passing

test('passing is illegal while a legal play exists', () => {
  const state = scenario({
    hands: [['5-2'], [], [], []],
    line: [[5, 3]],
  });
  throws(() => pass(state, 0), 'pass with a legal play rejected');
});

test('a pass proves the passer holds neither open value', () => {
  const state = scenario({
    hands: [['6-6'], ['5-5'], [], []],
    line: [[4, 1]],
  });
  pass(state, 0);
  assert(state.knownVoids[0].has(4), 'void in fours recorded');
  assert(state.knownVoids[0].has(1), 'void in ones recorded');
  eq(state.turn, 1, 'turn advanced:');
});

// ------------------------------------------------------ ending the hand

test('going out scores only the opponents pips', () => {
  const state = scenario({
    hands: [['5-2'], ['6-6', '6-5'], ['4-4'], ['3-3', '2-1']],
    line: [[5, 3]],
  });
  const result = play(state, 0, '5-2', 'left');

  eq(result.type, 'domino', 'hand ended by domino:');
  eq(result.winningSeat, 0);
  eq(result.winningTeam, 0);
  // Opponents are seats 1 and 3: (12 + 11) + (6 + 3) = 32.
  eq(result.points, 32, 'points scored:');
  eq(state.scores[0], 32, 'team 0 score:');
  eq(state.scores[1], 0, 'team 1 score:');
});

test('a blocked hand goes to the team with fewer pips', () => {
  // Both ends show six and nobody holds a six, so all four must pass.
  const state = scenario({
    hands: [['3-3'], ['5-4', '3-2'], ['1-0', '2-2'], ['4-4', '5-5']],
    line: [[6, 6]],
    turn: 1,
  });
  pass(state, 1);
  pass(state, 2);
  pass(state, 3);
  const result = pass(state, 0);

  eq(result.type, 'blocked', 'hand ended blocked:');
  // Team 0 holds 6 + 5 = 11; team 1 holds 14 + 18 = 32.
  eq(result.winningTeam, 0, 'fewer pips wins:');
  eq(result.points, 32, 'winners take the losers pips:');
  eq(state.scores[0], 32);
});

test('a blocked hand tied on pips scores nothing for either team', () => {
  const state = scenario({
    hands: [['3-3'], ['4-3'], ['1-0'], ['0-0']],
    line: [[6, 6]],
    turn: 1,
  });
  pass(state, 1);
  pass(state, 2);
  pass(state, 3);
  const result = pass(state, 0);

  eq(result.type, 'blockedTie', 'hand ended tied:');
  eq(result.winningTeam, null);
  eq(state.scores[0], 0, 'team 0 score:');
  eq(state.scores[1], 0, 'team 1 score:');
});

test('reaching the target ends the match', () => {
  const state = scenario({
    hands: [['5-2'], ['6-6', '6-5'], ['4-4'], ['3-3', '2-1']],
    line: [[5, 3]],
  });
  state.scores = [80, 40];
  const result = play(state, 0, '5-2', 'left');

  eq(state.scores[0], 112, 'final score:');
  assert(result.gameOver, 'game reported over');
  eq(state.phase, 'gameOver');
  eq(state.winningTeam, 0);
});

test('no move is accepted once the hand is over', () => {
  const state = scenario({
    hands: [['5-2'], ['6-6'], ['4-4'], ['3-3']],
    line: [[5, 3]],
  });
  play(state, 0, '5-2', 'left');
  throws(() => play(state, 1, '6-6', 'left'), 'play after hand end rejected');
});

// -------------------------------------------------------- full playthrough

test('a full match plays to completion without an illegal state', () => {
  const state = createGame({ targetScore: 100 });
  let guard = 0;

  while (state.phase !== 'gameOver') {
    startHand(state);
    while (state.phase === 'playing') {
      if (guard++ > 5000) throw new Error('game failed to terminate');
      const seat = state.turn;
      const moves = legalMoves(state, seat);
      if (moves.length === 0) {
        pass(state, seat);
      } else {
        const move = moves[0];
        play(state, seat, move.tileId, move.end);
      }
    }
    assert(state.handResult !== null, 'every hand produced a result');
  }

  assert(
    state.scores[0] >= 100 || state.scores[1] >= 100,
    'a team reached the target',
  );
  assert(state.winningTeam === 0 || state.winningTeam === 1, 'a team won');
});

/** Run everything and return `{ passed, failed, results }`. */
export function runTests() {
  const results = tests.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, error: error.message };
    }
  });
  return {
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
