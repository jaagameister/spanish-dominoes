// Bot opponents.
//
// Not a search — a weighted evaluation of every legal move, with the features
// drawn from the priority ordering in STRATEGY.md (itself synthesized from the
// Federación Española de Dominó training manual and the Venezuelan strategy
// literature). The weights are deliberately readable: each one corresponds to a
// named principle a human player would recognize, so tuning the bot and
// teaching the game stay the same activity.
//
// Everything here reads only public information plus the bot's own hand. It
// never inspects another player's tiles.

import { pips, isDouble, hasValue, otherEnd, totalPips } from './tiles.js';
import {
  ends,
  legalMoves,
  teamOf,
  partnerOf,
  nextSeat,
  opponentsOf,
} from './game.js';

const TILES_PER_NUMBER = 7;
const AVERAGE_HAND_PIPS = 42;

/** Weights for each strategic feature. Tuning happens here and nowhere else. */
const W = {
  forcesOpponentPass: 30, // §7 — squaring onto a number they've failed
  keepsPartnerAlive: 14, // §7 — never open the number partner passed on
  opensPartnerVoid: -34, // the same rule, stated as a penalty
  squaresBoth: 10, // §6 — cuadrar: halve the next player's options
  playsDouble: 12, // §4 — doubles are liabilities; shed them early
  doubleHangRisk: 9, // §4 — scaled by how exposed the double is
  releasesFirme: -22, // §5 — the last tile of a suit is closing control
  accompaniment: 5, // §3 — the Monte Carlo winner: ficha más acompañada
  createsFalla: -11, // §3 — never hand yourself a dead suit
  feedsOpponentSuit: -7, // §5 — don't open the entry numbers of their strong suit
  coversOpponentSuit: 8, // §1 — matar: kill the number the right-hand opponent plays
  pipShedding: 0.6, // §3 — score-conditional, not unconditional
  goesOut: 1000, // ending the hand dwarfs everything else
};

/**
 * Tiles of each number still unaccounted for from this seat's point of view:
 * seven per number, minus those on the table and those in its own hand.
 */
function unseenByNumber(state, seat) {
  const counts = new Array(TILES_PER_NUMBER).fill(TILES_PER_NUMBER);
  for (const placed of state.line) {
    for (let n = 0; n <= 6; n++) if (hasValue(placed.tile, n)) counts[n] -= 1;
  }
  for (const tile of state.hands[seat]) {
    for (let n = 0; n <= 6; n++) if (hasValue(tile, n)) counts[n] -= 1;
  }
  return counts;
}

/** How many tiles of a number are already on the table. */
function playedCount(state, number) {
  return state.line.filter((placed) => hasValue(placed.tile, number)).length;
}

/** Companions: other tiles in hand sharing this number. */
function accompaniment(hand, tile, number) {
  return hand.filter((t) => t.id !== tile.id && hasValue(t, number)).length;
}

/**
 * Do we hold the firme — the last unplayed tile of a suit? That tile is
 * guaranteed placement and the key to closing the game, so it is expensive to
 * spend casually.
 */
function isFirme(state, seat, tile, number) {
  const held = state.hands[seat].filter((t) => hasValue(t, number)).length;
  return playedCount(state, number) + held === TILES_PER_NUMBER && held === 1;
}

/**
 * A rough read of which numbers the opponents are strong in: numbers that are
 * largely unseen and that no opponent has passed on.
 */
function opponentStrength(state, seat) {
  const unseen = unseenByNumber(state, seat);
  const partner = partnerOf(seat);
  const strength = new Array(TILES_PER_NUMBER).fill(0);

  for (let n = 0; n <= 6; n++) {
    let live = 0;
    for (const other of opponentsOf(seat)) {
      if (!state.knownVoids[other].has(n)) live += 1;
    }
    // Discount numbers partner might be sitting on instead.
    if (!state.knownVoids[partner].has(n)) live -= 0.5;
    strength[n] = Math.max(0, unseen[n]) * live;
  }
  return strength;
}

/** The two open ends after a hypothetical move. */
function endsAfter(state, tile, end) {
  const open = ends(state);
  if (!open) return { left: tile.high, right: tile.low };
  if (end === 'left') {
    return { left: otherEnd(tile, open.left), right: open.right };
  }
  return { left: open.left, right: otherEnd(tile, open.right) };
}

/**
 * Score one candidate move. Higher is better. Every term is annotated with the
 * principle it encodes.
 */
function scoreMove(state, seat, move, context) {
  const { hand, partner, rightOpponent, strength, heavyHand, behind } = context;
  const tile = hand.find((t) => t.id === move.tileId);
  const open = ends(state);
  const after = endsAfter(state, tile, move.end);

  // Going out ends the hand and hands our team the opponents' pips.
  if (hand.length === 1) return W.goesOut + pips(tile);

  let score = 0;

  // The number we consumed, and the one we exposed.
  const matched =
    move.end === 'open' ? null : move.end === 'left' ? open.left : open.right;
  const exposed = move.end === 'left' ? after.left : after.right;

  // §7 — a pass is hard information. Presenting a number an opponent has
  // failed forces another pass; presenting one partner has failed strands him.
  const nextUp = nextSeat(seat);
  const nextIsOpponent = teamOf(nextUp) !== teamOf(seat);
  if (nextIsOpponent) {
    const voids = state.knownVoids[nextUp];
    if (voids.has(after.left) && voids.has(after.right)) {
      score += W.forcesOpponentPass;
    }
  }
  if (state.knownVoids[partner].has(exposed)) score += W.opensPartnerVoid;
  if (matched !== null && state.knownVoids[partner].has(matched)) {
    // Covering the number partner cannot play keeps him in the hand.
    score += W.keepsPartnerAlive;
  }

  // §6 — cuadrar. Both ends the same halves the next player's options and
  // guarantees the number survives around to partner.
  if (after.left === after.right) score += W.squaresBoth;

  // §4 — doubles are the hardest tiles to place and the only ones that can be
  // hung. Shed them early, weighted by how exposed this one is: a double with
  // two or three companions is the classic trap.
  if (isDouble(tile)) {
    score += W.playsDouble + pips(tile) * 0.4;
    const companions = accompaniment(hand, tile, tile.high);
    const exposure = companions >= 4 ? 0 : companions === 0 ? 0.4 : 1;
    score += W.doubleHangRisk * exposure;
  }

  // §5 — the firme is guaranteed placement and the key to a close. Spending it
  // for nothing throws away control of the endgame.
  if (matched !== null && isFirme(state, seat, tile, matched)) {
    score += W.releasesFirme;
  }

  // §3 — the most-accompanied tile: keep playing where you are long.
  score += W.accompaniment * accompaniment(hand, tile, exposed);

  // §3 — never manufacture a dead suit for yourself.
  const remainingInSuit = accompaniment(hand, tile, exposed);
  if (remainingInSuit === 0 && hand.length > 2) score += W.createsFalla;

  // §5 — "cerrar el juego": don't open the numbers that readmit an opponent's
  // strong suit.
  score -= W.feedsOpponentSuit * (strength[exposed] / TILES_PER_NUMBER);

  // §1 — matar: kill the number played by the opponent on the right, the one
  // pressuring our partner.
  const lastPlaced = state.line[state.line.length - 1];
  if (lastPlaced && matched !== null) {
    const lastBy = context.lastPlayer;
    if (lastBy === rightOpponent && hasValue(lastPlaced.tile, matched)) {
      score += W.coversOpponentSuit;
    }
  }

  // §3 — pip shedding is score-conditional, not unconditional. It matters when
  // our hand is heavy (a block would be expensive) or we are behind.
  const urgency = (heavyHand ? 1 : 0.35) + (behind ? 0.35 : 0);
  score += W.pipShedding * pips(tile) * urgency;

  return score;
}

/**
 * Choose a move for `seat`, or `null` when the seat must pass.
 * `difficulty` in [0, 1] blunts the bot by widening the band of moves it will
 * accept as "good enough" — a weak bot makes plausible mistakes rather than
 * random ones.
 */
export function chooseMove(state, seat, { difficulty = 1, rng = Math.random } = {}) {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const hand = state.hands[seat];
  const context = {
    hand,
    partner: partnerOf(seat),
    rightOpponent: nextSeat(seat),
    strength: opponentStrength(state, seat),
    heavyHand: totalPips(hand) > AVERAGE_HAND_PIPS * (hand.length / 7),
    behind: state.scores[teamOf(seat)] < state.scores[1 - teamOf(seat)],
    lastPlayer: state.lastPlayer ?? null,
  };

  const scored = moves.map((move) => ({
    move,
    score: scoreMove(state, seat, move, context),
  }));
  scored.sort((a, b) => b.score - a.score);

  // At full strength take the best move. Below it, sample from the moves within
  // a tolerance band of the best, so mistakes look like ordinary misjudgment.
  if (difficulty >= 1) return scored[0].move;

  const spread = Math.abs(scored[0].score - scored[scored.length - 1].score);
  const tolerance = spread * (1 - difficulty);
  const acceptable = scored.filter((s) => s.score >= scored[0].score - tolerance);
  return acceptable[Math.floor(rng() * acceptable.length)].move;
}

/** Debug aid: the bot's ranking of its options, for a "why did it do that" view. */
export function explainMoves(state, seat) {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return [];
  const hand = state.hands[seat];
  const context = {
    hand,
    partner: partnerOf(seat),
    rightOpponent: nextSeat(seat),
    strength: opponentStrength(state, seat),
    heavyHand: totalPips(hand) > AVERAGE_HAND_PIPS * (hand.length / 7),
    behind: state.scores[teamOf(seat)] < state.scores[1 - teamOf(seat)],
    lastPlayer: state.lastPlayer ?? null,
  };
  return moves
    .map((move) => ({ move, score: scoreMove(state, seat, move, context) }))
    .sort((a, b) => b.score - a.score);
}
