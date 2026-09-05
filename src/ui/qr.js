// A QR encoder, in enough of the spec to put an invite link on screen.
//
// Byte mode, error correction level M, versions 1 through 10 — comfortably
// more than a URL needs. Written out rather than pulled in so the project keeps
// no dependencies, and verified bit-for-bit against the `qrcode` npm package in
// test/qr.test.js: the fixtures there are that library's output, so any drift
// from the real specification fails the suite rather than producing a code that
// looks plausible and scans to nothing.
//
// Reference: ISO/IEC 18004.

const EC_LEVEL_BITS = 0b00; // level M
const MAX_VERSION = 10;

/**
 * Per version at level M: error-correction codewords per block, then the block
 * groups as [count, dataCodewordsEach].
 */
const EC_TABLE = {
  1: { ecPerBlock: 10, groups: [[1, 16]] },
  2: { ecPerBlock: 16, groups: [[1, 28]] },
  3: { ecPerBlock: 26, groups: [[1, 44]] },
  4: { ecPerBlock: 18, groups: [[2, 32]] },
  5: { ecPerBlock: 24, groups: [[2, 43]] },
  6: { ecPerBlock: 16, groups: [[4, 27]] },
  7: { ecPerBlock: 18, groups: [[4, 31]] },
  8: { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  9: { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  10: { ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
};

/** Row/column centres of the alignment patterns, by version. */
const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// ------------------------------------------------------- GF(256) arithmetic

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR field's primitive polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function mul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial of the given degree, coefficients high-order first. */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon remainder: the error-correction codewords for one block. */
function ecCodewords(data, ecLength) {
  const gen = generatorPoly(ecLength);
  const remainder = new Uint8Array(data.length + ecLength);
  remainder.set(data);

  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      remainder[i + j] ^= mul(gen[j], factor);
    }
  }
  return remainder.slice(data.length);
}

// --------------------------------------------------------------- bit stream

class BitBuffer {
  constructor() {
    this.bits = [];
  }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

function dataCapacity(version) {
  return EC_TABLE[version].groups.reduce(
    (sum, [count, each]) => sum + count * each,
    0,
  );
}

function chooseVersion(byteLength) {
  for (let version = 1; version <= MAX_VERSION; version++) {
    // 4 bits of mode indicator, plus the character count field.
    const countBits = version < 10 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (needed <= dataCapacity(version) * 8) return version;
  }
  throw new Error(
    `${byteLength} bytes is too long for a version ${MAX_VERSION} QR code`,
  );
}

/** Mode indicator, length, payload, terminator, padding — the data codewords. */
function encodeData(bytes, version) {
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.put(byte, 8);

  const capacityBits = dataCapacity(version) * 8;
  buffer.put(0, Math.min(4, capacityBits - buffer.length)); // terminator
  while (buffer.length % 8 !== 0) buffer.put(0, 1);

  const codewords = [];
  for (let i = 0; i < buffer.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buffer.bits[i + j];
    codewords.push(byte);
  }

  // The two alternating pad codewords the specification prescribes.
  const pads = [0xec, 0x11];
  for (let i = 0; codewords.length < dataCapacity(version); i++) {
    codewords.push(pads[i % 2]);
  }
  return codewords;
}

/** Split into blocks, add error correction, then interleave as the spec requires. */
function buildCodewords(dataCodewords, version) {
  const { ecPerBlock, groups } = EC_TABLE[version];

  const blocks = [];
  let offset = 0;
  for (const [count, each] of groups) {
    for (let i = 0; i < count; i++) {
      const data = dataCodewords.slice(offset, offset + each);
      offset += each;
      blocks.push({ data, ec: ecCodewords(Uint8Array.from(data), ecPerBlock) });
    }
  }

  const result = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of blocks) result.push(block.ec[i]);
  }
  return result;
}

// ------------------------------------------------------------ module layout

function emptyMatrix(size) {
  return {
    modules: Array.from({ length: size }, () => new Array(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
    size,
  };
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      // -1 and 7 are the light separator around the pattern, not part of it.
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const onRing = inside && (r === 0 || r === 6 || c === 0 || c === 6);
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m.modules[rr][cc] = onRing || inCore;
      m.reserved[rr][cc] = true;
    }
  }
}

function placeAlignment(m, version) {
  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const col of centres) {
      // The three finder corners have no alignment pattern.
      const nearFinder =
        (row === 6 && col === 6) ||
        (row === 6 && col === m.size - 7) ||
        (row === m.size - 7 && col === 6);
      if (nearFinder) continue;

      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          m.modules[row + r][col + c] =
            Math.max(Math.abs(r), Math.abs(c)) !== 1;
          m.reserved[row + r][col + c] = true;
        }
      }
    }
  }
}

function placeTiming(m) {
  for (let i = 8; i < m.size - 8; i++) {
    const on = i % 2 === 0;
    m.modules[6][i] = on;
    m.reserved[6][i] = true;
    m.modules[i][6] = on;
    m.reserved[i][6] = true;
  }
}

function reserveFormat(m, version) {
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      m.reserved[8][i] = true;
      m.reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8][m.size - 1 - i] = true;
    m.reserved[m.size - 1 - i][8] = true;
  }
  // The dark module, always set, just above the lower-left format strip.
  m.modules[m.size - 8][8] = true;
  m.reserved[m.size - 8][8] = true;

  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        m.reserved[m.size - 11 + j][i] = true;
        m.reserved[i][m.size - 11 + j] = true;
      }
    }
  }
}

/** Fill the data region, snaking upward and downward in two-column strips. */
function placeData(m, codewords) {
  let bitIndex = 0;
  let upward = true;

  for (let right = m.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern is skipped

    for (let step = 0; step < m.size; step++) {
      const row = upward ? m.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (m.reserved[row][col]) continue;
        const byte = codewords[bitIndex >>> 3];
        const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIndex & 7))) & 1;
        m.modules[row][col] = bit === 1;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0,
  (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0,
];

function applyMask(m, maskIndex) {
  const mask = MASKS[maskIndex];
  const out = {
    size: m.size,
    reserved: m.reserved,
    modules: m.modules.map((row) => row.slice()),
  };
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.reserved[r][c] && mask(r, c)) out.modules[r][c] = !out.modules[r][c];
    }
  }
  return out;
}

/** The four penalty rules, used to pick the least-bad mask. */
function penalty(m) {
  const size = m.size;
  const at = (r, c) => m.modules[r][c];
  let score = 0;

  // Rule 1: runs of five or more of the same colour.
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const prev = horizontal ? at(i, j - 1) : at(j - 1, i);
        const curr = horizontal ? at(i, j) : at(j, i);
        if (curr === prev) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) {
        score += 3;
      }
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 pattern with four light modules beside it.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c + 11 <= size; c++) {
      let matchA = true;
      let matchB = true;
      let vMatchA = true;
      let vMatchB = true;
      for (let k = 0; k < 11; k++) {
        const h = at(r, c + k);
        if (h !== A[k]) matchA = false;
        if (h !== B[k]) matchB = false;
        const v = at(c + k, r);
        if (v !== A[k]) vMatchA = false;
        if (v !== B[k]) vMatchB = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
      if (vMatchA) score += 40;
      if (vMatchB) score += 40;
    }
  }

  // Rule 4: deviation from an even balance of dark and light.
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (at(r, c)) dark++;
  }
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** BCH(15,5) format information, masked as the specification requires. */
function formatBits(maskIndex) {
  const data = (EC_LEVEL_BITS << 3) | maskIndex;
  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >>> i) & 1) value ^= 0x537 << (i - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

/** BCH(18,6) version information, for versions 7 and up. */
function versionBits(version) {
  let value = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((value >>> i) & 1) value ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | value;
}

/**
 * The fifteen format modules, written twice. Position k carries bit 14 - k:
 * the most significant bit sits at (8, 0) and the sequence runs from there.
 */
const FORMAT_POSITIONS = [
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
  [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
];

function placeFormat(m, maskIndex) {
  const bits = formatBits(maskIndex);
  const bitAt = (k) => ((bits >>> (14 - k)) & 1) === 1;

  FORMAT_POSITIONS.forEach(([row, col], k) => {
    m.modules[row][col] = bitAt(k);
  });

  // The second copy: up the bottom-left column, then along the top-right row.
  // The dark module at (size - 8, 8) sits between the two runs and is not part
  // of either.
  for (let k = 0; k <= 6; k++) m.modules[m.size - 1 - k][8] = bitAt(k);
  for (let k = 7; k <= 14; k++) m.modules[8][m.size - 15 + k] = bitAt(k);
}

function placeVersion(m, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = i % 3;
    m.modules[m.size - 11 + col][row] = on;
    m.modules[row][m.size - 11 + col] = on;
  }
}

// ---------------------------------------------------------------- public API

/**
 * Encode `text` as a QR matrix.
 * Returns `{ size, modules }`, where `modules[row][col]` is true for dark.
 */
export function encode(text) {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const codewords = buildCodewords(encodeData(bytes, version), version);

  const base = emptyMatrix(17 + 4 * version);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, base.size - 7);
  placeFinder(base, base.size - 7, 0);
  placeAlignment(base, version);
  placeTiming(base);
  reserveFormat(base, version);
  placeData(base, codewords);

  let best = null;
  for (let maskIndex = 0; maskIndex < 8; maskIndex++) {
    const candidate = applyMask(base, maskIndex);
    placeFormat(candidate, maskIndex);
    placeVersion(candidate, version);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { score, candidate };
  }

  return { size: best.candidate.size, modules: best.candidate.modules, version };
}

/**
 * Render `text` as an SVG string. `quiet` is the mandatory light border, in
 * modules — four is the specification's minimum and scanners rely on it.
 */
export function toSvg(text, { quiet = 4, dark = '#101815', light = '#f2efe4' } = {}) {
  const { size, modules } = encode(text);
  const total = size + quiet * 2;

  // One path for every dark module keeps the markup small and scales cleanly.
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code for ${text}">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  );
}
