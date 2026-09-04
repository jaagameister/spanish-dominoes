// Bot opponents.
//
// Not a search — a weighted evaluation of every legal move, with the features
// drawn from the priority ordering in STRATEGY.md (itself synthesized from the
// Federación Española de Dominó training manual and the Venezuelan strategy
// literature). Each weight corresponds to a named principle a human player
// would recognize, so tuning the bot and teaching the game stay the same
// activity — and every move carries the reasons behind it, which is what the
// end-of-hand review displays.
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
  keepsPartnerAlive: 14, // §7 — cover the number partner passed on
  opensPartnerVoid: -34, // the same rule, as a penalty
  squaresBoth: 10, // §6 — cuadrar: halve the next player's options
  playsDouble: 12, // §5 — doubles are liabilities; shed them early
  doubleHangRisk: 9, // §5 — scaled by how exposed the double is
  releasesFirme: -22, // §8 — the last tile of a suit is closing control
  accompaniment: 5, // §4 — the Monte Carlo winner: play your long suit
  createsFalla: -11, // §0 — never hand yourself a dead suit
  feedsOpponentSuit: -7, // §7 — don't reopen their strong suit
  coversOpponentSuit: 8, // §3 — kill the number played before your partner
  pipShedding: 0.6, // §12 — score-conditional, not unconditional
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

function playedCount(state, number) {
  return state.line.filter((placed) => hasValue(placed.tile, number)).length;
}

/** Companions: other tiles in hand sharing this number. */
function accompaniment(hand, tile, number) {
  return hand.filter((t) => t.id !== tile.id && hasValue(t, number)).length;
}

/**
 * Do we hold the firme — the last unplayed tile of a suit? It is guaranteed
 * placement and the key to closing the game, so it is expensive to spend.
 */
function isFirme(state, seat, number) {
  const held = state.hands[seat].filter((t) => hasValue(t, number)).length;
  return playedCount(state, number) + held === TILES_PER_NUMBER && held === 1;
}

/** A rough read of the numbers the opponents are likely strong in. */
function opponentStrength(state, seat) {
  const unseen = unseenByNumber(state, seat);
  const partner = partnerOf(seat);
  const strength = new Array(TILES_PER_NUMBER).fill(0);

  for (let n = 0; n <= 6; n++) {
    let live = 0;
    for (const other of opponentsOf(seat)) {
      if (!state.knownVoids[other].has(n)) live += 1;
    }
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

function buildContext(state, seat) {
  const hand = state.hands[seat];
  return {
    hand,
    partner: partnerOf(seat),
    rightOpponent: nextSeat(seat),
    strength: opponentStrength(state, seat),
    heavyHand: totalPips(hand) > AVERAGE_HAND_PIPS * (hand.length / 7),
    behind: state.scores[teamOf(seat)] < state.scores[1 - teamOf(seat)],
    lastPlayer: state.lastPlayer ?? null,
  };
}

/**
 * Score one candidate move, returning both the total and the plain-language
 * reasons that produced it. Reasons are what the review panel shows, so they
 * are written to be read by a player, not a developer.
 */
function evaluate(state, seat, move, context) {
  const { hand, partner, rightOpponent, strength, heavyHand, behind } = context;
  const tile = hand.find((t) => t.id === move.tileId);
  const open = ends(state);
  const after = endsAfter(state, tile, move.end);
  const reasons = [];

  let score = 0;
  const add = (value, text) => {
    if (value === 0) return;
    score += value;
    reasons.push({ value: Math.round(value * 10) / 10, text });
  };

  if (hand.length === 1) {
    add(W.goesOut + pips(tile), 'Goes out — ends the hand and banks their pips');
    return { score, reasons };
  }

  const matched =
    move.end === 'open' ? null : move.end === 'left' ? open.left : open.right;
  const exposed = move.end === 'left' ? after.left : after.right;

  // §7 — a pass is hard information.
  const nextUp = nextSeat(seat);
  if (teamOf(nextUp) !== teamOf(seat)) {
    const voids = state.knownVoids[nextUp];
    if (voids.has(after.left) && voids.has(after.right)) {
      add(W.forcesOpponentPass, 'Forces the next opponent to pass — they have failed both ends');
    }
  }
  if (state.knownVoids[partner].has(exposed)) {
    add(W.opensPartnerVoid, `Opens ${exposed}s, which partner has passed on`);
  }
  if (matched !== null && state.knownVoids[partner].has(matched)) {
    add(W.keepsPartnerAlive, `Covers ${matched}s, which partner cannot play`);
  }

  // §6 — cuadrar.
  if (after.left === after.right) {
    add(W.squaresBoth, `Squares the game on ${after.left}s — partner is guaranteed the number`);
  }

  // §5 — doubles.
  if (isDouble(tile)) {
    add(W.playsDouble + pips(tile) * 0.4, 'Sheds a double while it can still be placed');
    const companions = accompaniment(hand, tile, tile.high);
    const exposure = companions >= 4 ? 0 : companions === 0 ? 0.4 : 1;
    if (exposure > 0) {
      add(
        W.doubleHangRisk * exposure,
        companions >= 1 && companions <= 3
          ? 'That double was at real risk of being hung'
          : 'Unloads dead weight',
      );
    }
  }

  // §8 — the firme.
  if (matched !== null && isFirme(state, seat, matched)) {
    add(W.releasesFirme, `Spends the last ${matched} — gives up control of the close`);
  }

  // §4 — play your long suit.
  const companionsAfter = accompaniment(hand, tile, exposed);
  if (companionsAfter > 0) {
    add(
      W.accompaniment * companionsAfter,
      `Keeps ${exposed}s open, where ${companionsAfter} more tile${
        companionsAfter === 1 ? ' sits' : 's sit'
      } in hand`,
    );
  }

  // §0 — don't manufacture a void.
  if (companionsAfter === 0 && hand.length > 2) {
    add(W.createsFalla, `Leaves nothing else in ${exposed}s`);
  }

  // §7 — don't reopen their strong suit.
  const feed = W.feedsOpponentSuit * (strength[exposed] / TILES_PER_NUMBER);
  if (feed < -0.5) add(feed, `${exposed}s look live in their hands`);

  // §3 — kill the number played before your partner.
  const lastPlaced = state.line[state.line.length - 1];
  if (lastPlaced && matched !== null && context.lastPlayer === rightOpponent) {
    if (hasValue(lastPlaced.tile, matched)) {
      add(W.coversOpponentSuit, 'Kills the number the opponent before partner just opened');
    }
  }

  // §12 — pip shedding is conditional.
  const urgency = (heavyHand ? 1 : 0.35) + (behind ? 0.35 : 0);
  add(
    W.pipShedding * pips(tile) * urgency,
    heavyHand ? `Sheds ${pips(tile)} pips from a heavy hand` : `Sheds ${pips(tile)} pips`,
  );

  return { score, reasons };
}

/** Every legal move, scored and explained, best first. */
export function rankMoves(state, seat) {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return [];
  const context = buildContext(state, seat);
  return moves
    .map((move) => ({ move, ...evaluate(state, seat, move, context) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Choose a move for `seat`, or `null` when the seat must pass.
 * `difficulty` in [0, 1] blunts the bot by widening the band of moves it will
 * accept, so a weak bot makes plausible misjudgments rather than random ones.
 */
export function chooseMove(state, seat, options = {}) {
  const choice = explainChoice(state, seat, options);
  return choice ? choice.move : null;
}

/**
 * As `chooseMove`, but returns the reasoning as well: the chosen move with its
 * reasons, and the runner-up it was preferred over. This is what the
 * end-of-hand review records.
 */
export function explainChoice(state, seat, { difficulty = 1, rng = Math.random } = {}) {
  const ranked = rankMoves(state, seat);
  if (ranked.length === 0) return null;

  let picked = ranked[0];

  if (difficulty < 1 && ranked.length > 1) {
    const spread = Math.abs(ranked[0].score - ranked[ranked.length - 1].score);
    const tolerance = spread * (1 - difficulty);
    const acceptable = ranked.filter((r) => r.score >= ranked[0].score - tolerance);
    picked = acceptable[Math.floor(rng() * acceptable.length)];
  }

  // Forced means no real decision was made. Two placements of the same tile
  // still count as forced: the tile was never in question, only the end.
  const distinctTiles = new Set(ranked.map((r) => r.move.tileId));

  return {
    move: picked.move,
    score: picked.score,
    reasons: picked.reasons,
    forced: distinctTiles.size === 1,
    onlyTile: distinctTiles.size === 1 ? picked.move.tileId : null,
    runnerUp: ranked.find((r) => r !== picked) ?? null,
  };
}
