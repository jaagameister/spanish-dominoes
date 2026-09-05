// The engine suite, run under Node.
//
// The cases themselves live in src/engine/tests.js so that the same suite runs
// both here and in the browser at /tests.html — one set of tests, two runners,
// no risk of the two drifting apart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runTests } from '../src/engine/tests.js';

const { results } = runTests();

for (const result of results) {
  test(result.name, () => {
    assert.ok(result.ok, result.error);
  });
}
