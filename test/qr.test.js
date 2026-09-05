// Verifies the hand-written QR encoder against the real thing.
//
// The fixtures in test/fixtures/qr-vectors.json are the output of the `qrcode`
// npm package at error-correction level M, captured once. Comparing whole
// matrices bit for bit is the point: a QR code that is wrong in a handful of
// modules still *looks* like a QR code, and the only way to catch that without
// pointing a phone at the screen is to diff against a known-good encoder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode, toSvg } from '../src/ui/qr.js';

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/qr-vectors.json', import.meta.url), 'utf8'),
);

function label(text) {
  return text.length > 34 ? `${text.slice(0, 31)}…` : text;
}

for (const vector of vectors) {
  test(`QR v${vector.version}: ${label(vector.text)}`, () => {
    const { size, modules, version } = encode(vector.text);

    assert.equal(version, vector.version, 'version');
    assert.equal(size, vector.size, 'matrix size');

    const actual = modules.map((row) => row.map((on) => (on ? '1' : '0')).join(''));
    for (let r = 0; r < size; r++) {
      assert.equal(actual[r], vector.rows[r], `row ${r} differs`);
    }
  });
}

test('every fixture round-trips through the whole set', () => {
  // A guard on the fixtures themselves: if this file ever loses its coverage of
  // the multi-block and version-info paths, the suite should say so.
  const versions = new Set(vectors.map((v) => v.version));
  assert.ok(versions.has(1), 'a version 1 code');
  assert.ok([...versions].some((v) => v >= 7), 'a version with version info');
  assert.ok([...versions].some((v) => v >= 8), 'a version with two block groups');
});

test('non-ASCII text is encoded as UTF-8 bytes', () => {
  const vector = vectors.find((v) => /[^\x00-\x7F]/.test(v.text));
  assert.ok(vector, 'fixture set includes non-ASCII text');
  const { modules } = encode(vector.text);
  assert.equal(modules[0].map((m) => (m ? '1' : '0')).join(''), vector.rows[0]);
});

test('text too long for version 10 is refused rather than silently truncated', () => {
  assert.throws(() => encode('x'.repeat(300)), /too long/);
});

test('toSvg renders the quiet zone and one rect per dark module', () => {
  const svg = toSvg('http://192.168.0.163:8000', { quiet: 4 });
  const { size, modules } = encode('http://192.168.0.163:8000');
  const total = size + 8;

  assert.match(svg, new RegExp(`viewBox="0 0 ${total} ${total}"`));

  const dark = modules.flat().filter(Boolean).length;
  const drawn = (svg.match(/M\d+ \d+h1v1h-1z/g) ?? []).length;
  assert.equal(drawn, dark, 'one path segment per dark module');
});
