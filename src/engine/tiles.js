// Tiles for a double-6 set. Pure functions — no game state, no DOM.

export const MAX_PIP = 6;

/** A tile is `{ high, low }` with high >= low. Its id is `"high-low"`. */
export function makeTile(a, b) {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return { high, low, id: `${high}-${low}` };
}

/** All 28 tiles of a double-6 set, in a stable order. */
export function fullSet() {
  const tiles = [];
  for (let high = 0; high <= MAX_PIP; high++) {
    for (let low = 0; low <= high; low++) {
      tiles.push(makeTile(high, low));
    }
  }
  return tiles;
}

export function pips(tile) {
  return tile.high + tile.low;
}

export function isDouble(tile) {
  return tile.high === tile.low;
}

/** Does this tile carry the given number on either end? */
export function hasValue(tile, value) {
  return tile.high === value || tile.low === value;
}

/** The other end of a tile, given one of its values. */
export function otherEnd(tile, value) {
  return tile.high === value ? tile.low : tile.high;
}

/** Total pips across a group of tiles — the currency of every score here. */
export function totalPips(tiles) {
  return tiles.reduce((sum, tile) => sum + pips(tile), 0);
}

/** Fisher-Yates, against an injectable RNG so tests can be deterministic. */
export function shuffle(tiles, rng = Math.random) {
  const out = tiles.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
