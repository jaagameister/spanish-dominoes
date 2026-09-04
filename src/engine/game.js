// Game state machine for Partnership Dominoes (Venezuelan variant).
//
// Double-6 set, all 28 tiles dealt seven apiece, two fixed partnerships. Play
// if you can, pass if you cannot. The hand ends when someone sheds their last
// tile, or when all four players pass in a row and the game is blocked.
//
// The engine knows nothing about the DOM, bots or networking: callers drive it
// by asking for legal moves and submitting one at a time. The same engine can
// therefore run in the browser against bots now and authoritatively on a
// server later.

import {
  fullSet,
  shuffle,
  hasValue,
  otherEnd,
  totalPips,
} from './tiles.js';

export const SEATS = 4;
export const HAND_SIZE = 7;
export const DEFAULT_TARGET = 100;
export const OPENING_TILE_ID = '6-6';

/** Seats 0 and 2 are team 0; seats 1 and 3 are team 1. Partners face each other. */
export function teamOf(seat) {
  return seat % 2;
}

export function partnerOf(seat) {
  return (seat + 2) % SEATS;
}

/** Turn order runs to the left. */
export function nextSeat(seat) {
  return (seat + 1) % SEATS;
}

export function opponentsOf(seat) {
  return [(seat + 1) % SEATS, (seat + 3) % SEATS];
}

export function createGame({
  targetScore = DEFAULT_TARGET,
  rng = Math.random,
} = {}) {
  return {
    targetScore,
    rng,
    scores: [0, 0],
    handNumber: 0,
    starter: null,
    turn: null,
    hands: [[], [], [], []],
    // Placed tiles in visual order. Each entry is `{ tile, a, b }` where `a` is
    // the value facing left and `b` the value facing right.
    line: [],
    openingTileId: null,
    passesInARow: 0,
    // Public inference: seats known to hold no tile bearing a given value,
    // proven by a pass. Bots and the UI both read this.
    knownVoids: [new Set(), new Set(), new Set(), new Set()],
    handResult: null,
    phase: 'idle',
    winningTeam: null,
  };
}

/** The two open ends of the layout, or `null` before the first tile. */
export function ends(state) {
  if (state.line.length === 0) return null;
  return { left: state.line[0].a, right: state.line[state.line.length - 1].b };
}

/** Deal a fresh hand and decide who opens it. */
export function startHand(state) {
  const deck = shuffle(fullSet(), state.rng);
  state.hands = [];
  for (let seat = 0; seat < SEATS; seat++) {
    state.hands.push(deck.slice(seat * HAND_SIZE, (seat + 1) * HAND_SIZE));
  }

  if (state.handNumber === 0) {
    // First hand of the match: whoever holds the double-six opens with it.
    state.starter = state.hands.findIndex((hand) =>
      hand.some((tile) => tile.id === OPENING_TILE_ID),
    );
    state.openingTileId = OPENING_TILE_ID;
  } else {
    // Afterwards the opening passes one seat to the left, and the opener may
    // lead any tile they like.
    state.starter = nextSeat(state.starter);
    state.openingTileId = null;
  }

  state.handNumber += 1;
  state.turn = state.starter;
  state.line = [];
  state.passesInARow = 0;
  state.knownVoids = [new Set(), new Set(), new Set(), new Set()];
  state.handResult = null;
  state.phase = 'playing';
  return state;
}

/**
 * Every move `seat` may legally make right now, as
 * `{ tileId, end: 'left' | 'right' | 'open' }`. A tile matching both open ends
 * yields two moves, because which end you choose matters.
 */
export function legalMoves(state, seat) {
  if (state.phase !== 'playing' || state.turn !== seat) return [];
  const hand = state.hands[seat];

  if (state.line.length === 0) {
    const openable = state.openingTileId
      ? hand.filter((tile) => tile.id === state.openingTileId)
      : hand;
    return openable.map((tile) => ({ tileId: tile.id, end: 'open' }));
  }

  const { left, right } = ends(state);
  const moves = [];
  for (const tile of hand) {
    if (hasValue(tile, left)) moves.push({ tileId: tile.id, end: 'left' });
    if (hasValue(tile, right)) moves.push({ tileId: tile.id, end: 'right' });
  }
  return moves;
}

export function canPlay(state, seat) {
  return legalMoves(state, seat).length > 0;
}

/**
 * Play one tile. Returns `{ type: 'played' }`, or the hand-ending event when
 * this move sheds the player's last tile.
 */
export function play(state, seat, tileId, end) {
  if (state.phase !== 'playing') throw new Error(`game is ${state.phase}`);
  if (state.turn !== seat) throw new Error(`not seat ${seat}'s turn`);

  const legal = legalMoves(state, seat);
  const move = legal.find((m) => m.tileId === tileId && m.end === end);
  if (!move) throw new Error(`seat ${seat} cannot play ${tileId} on ${end}`);

  const tile = state.hands[seat].find((t) => t.id === tileId);
  state.hands[seat] = state.hands[seat].filter((t) => t.id !== tileId);

  if (end === 'open') {
    state.line.push({ tile, a: tile.high, b: tile.low });
  } else if (end === 'left') {
    const matched = state.line[0].a;
    state.line.unshift({ tile, a: otherEnd(tile, matched), b: matched });
  } else {
    const matched = state.line[state.line.length - 1].b;
    state.line.push({ tile, a: matched, b: otherEnd(tile, matched) });
  }

  state.passesInARow = 0;

  if (state.hands[seat].length === 0) return finishByDomino(state, seat);

  state.turn = nextSeat(seat);
  return { type: 'played', seat, tile, end };
}

/**
 * Pass. Only legal with no playable tile — and it is public information, so it
 * records that this seat holds neither open-end value.
 */
export function pass(state, seat) {
  if (state.phase !== 'playing') throw new Error(`game is ${state.phase}`);
  if (state.turn !== seat) throw new Error(`not seat ${seat}'s turn`);
  if (canPlay(state, seat)) throw new Error(`seat ${seat} has a legal play`);

  const open = ends(state);
  if (open) {
    state.knownVoids[seat].add(open.left);
    state.knownVoids[seat].add(open.right);
  }

  state.passesInARow += 1;
  if (state.passesInARow >= SEATS) return finishByBlock(state);

  state.turn = nextSeat(seat);
  return { type: 'passed', seat };
}

function pipsByTeam(state) {
  return [
    totalPips(state.hands[0]) + totalPips(state.hands[2]),
    totalPips(state.hands[1]) + totalPips(state.hands[3]),
  ];
}

/** Someone shed their last tile: their team takes the opponents' pips. */
function finishByDomino(state, seat) {
  const winningTeam = teamOf(seat);
  const points = pipsByTeam(state)[1 - winningTeam];
  return concludeHand(state, {
    type: 'domino',
    winningSeat: seat,
    winningTeam,
    points,
    pips: pipsByTeam(state),
  });
}

/**
 * Four passes in a row. The team holding fewer pips wins and scores the
 * opponents' pips; an exact tie scores nothing for either side.
 */
function finishByBlock(state) {
  const pips = pipsByTeam(state);
  if (pips[0] === pips[1]) {
    return concludeHand(state, {
      type: 'blockedTie',
      winningTeam: null,
      points: 0,
      pips,
    });
  }
  const winningTeam = pips[0] < pips[1] ? 0 : 1;
  return concludeHand(state, {
    type: 'blocked',
    winningTeam,
    points: pips[1 - winningTeam],
    pips,
  });
}

function concludeHand(state, result) {
  if (result.winningTeam !== null) {
    state.scores[result.winningTeam] += result.points;
  }
  state.handResult = result;
  state.turn = null;

  const [a, b] = state.scores;
  if (a >= state.targetScore || b >= state.targetScore) {
    state.winningTeam = a > b ? 0 : b > a ? 1 : null;
    state.phase = 'gameOver';
    return { ...result, gameOver: true, winningTeam: state.winningTeam };
  }

  state.phase = 'handOver';
  return { ...result, gameOver: false };
}
