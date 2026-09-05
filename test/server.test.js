// Integration tests for the multiplayer server.
//
// The important ones are under "redaction": they assert that the server never
// sends a player another player's tiles. That is the guarantee the whole online
// game rests on, so it is tested rather than merely intended.

import test from 'node:test';
import assert from 'node:assert/strict';
import { start, server } from '../server/server.js';

// Bound in `before` rather than at module scope: a top-level await here hangs
// the test runner before it registers anything.
let BASE;

test.before(async () => {
  const listening = await start(0);
  BASE = `http://localhost:${listening.address().port}`;
});

test.after(() => {
  // SSE streams are long-lived by design, so close() alone would wait forever.
  server.closeAllConnections();
  server.close();
});

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

/** Read the first state event off a player's SSE stream, then hang up. */
async function firstEvent(path) {
  const controller = new AbortController();
  const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const line = buffer.split('\n').find((l) => l.startsWith('data: '));
      if (line) return JSON.parse(line.slice(6));
    }
    throw new Error('stream closed before any state arrived');
  } finally {
    controller.abort();
  }
}

/** A room with two humans and two bots, already in play. */
async function seatedGame() {
  const host = await post('/api/rooms', { name: 'Freeman' });
  const guest = await post(`/api/rooms/${host.code}/join`, { name: 'Ada' });
  await post(`/api/rooms/${host.code}/start`, { token: host.token });
  return { code: host.code, host, guest };
}

// ------------------------------------------------------------------ lobby

test('creating a room seats the host and returns a code', async () => {
  const room = await post('/api/rooms', { name: 'Freeman' });
  assert.match(room.code, /^[A-Z0-9]{4}$/);
  assert.equal(room.seat, 0);
  assert.ok(room.token);
});

test('a second player takes the next seat, which is an opponent', async () => {
  const host = await post('/api/rooms', { name: 'Freeman' });
  const guest = await post(`/api/rooms/${host.code}/join`, { name: 'Ada' });
  assert.equal(guest.seat, 1);
  // Seats alternate between teams, so adjacent seats are always opponents.
  assert.notEqual(host.seat % 2, guest.seat % 2);
});

test('joining a code that does not exist is refused', async () => {
  const result = await post('/api/rooms/ZZZZ/join', { name: 'Nobody' });
  assert.ok(result.error);
});

test('only the host may start the game', async () => {
  const host = await post('/api/rooms', { name: 'Freeman' });
  const guest = await post(`/api/rooms/${host.code}/join`, { name: 'Ada' });

  const refused = await post(`/api/rooms/${host.code}/start`, { token: guest.token });
  assert.ok(refused.error);

  const allowed = await post(`/api/rooms/${host.code}/start`, { token: host.token });
  assert.ok(allowed.ok);
});

test('empty seats are filled with bots at the start', async () => {
  const { host } = await seatedGame();
  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  const kinds = view.players.map((p) => p.kind);
  assert.deepEqual(kinds, ['human', 'human', 'bot', 'bot']);
});

// --------------------------------------------------------------- redaction

test('redaction: a player is sent their own seven tiles', async () => {
  const { host } = await seatedGame();
  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  assert.equal(view.seat, 0);
  assert.equal(view.hand.length, 7);
});

test('redaction: no other hand appears anywhere in a player payload', async () => {
  const { host, guest } = await seatedGame();
  const mine = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  const theirs = await firstEvent(`/api/rooms/${host.code}/stream?token=${guest.token}`);

  const myTiles = mine.hand.map((t) => t.id);
  const theirTiles = theirs.hand.map((t) => t.id);

  // The two hands are disjoint, as they must be — all 28 tiles are dealt.
  assert.equal(myTiles.filter((id) => theirTiles.includes(id)).length, 0);

  // And nothing of theirs is reachable anywhere in my payload, at any depth.
  const blob = JSON.stringify(mine);
  for (const id of theirTiles) {
    assert.ok(!blob.includes(`"${id}"`), `payload leaked opponent tile ${id}`);
  }
});

test('redaction: opponents expose only a tile count and their proven voids', async () => {
  const { host } = await seatedGame();
  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  for (const player of view.players) {
    assert.deepEqual(Object.keys(player).sort(), [
      'connected',
      'kind',
      'name',
      'seat',
      'tiles',
      'voids',
    ]);
  }
});

test('redaction: a stream without a valid token reveals no hand at all', async () => {
  const { host } = await seatedGame();
  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=not-a-real-token`);
  assert.equal(view.seat, -1);
  assert.deepEqual(view.hand, []);
  assert.deepEqual(view.legalMoves, []);
});

// ------------------------------------------------------------------ moves

test('an unrecognized token cannot act', async () => {
  const { host } = await seatedGame();
  const result = await post(`/api/rooms/${host.code}/action`, {
    token: 'not-a-real-token',
    type: 'pass',
  });
  assert.ok(result.error);
});

test('a player cannot move out of turn', async () => {
  const { host, guest } = await seatedGame();
  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);

  // Whichever human is not on turn tries to play; the engine must refuse.
  const idle = view.turn === 0 ? guest : host;
  const result = await post(`/api/rooms/${host.code}/action`, {
    token: idle.token,
    type: 'play',
    tileId: '6-6',
    end: 'open',
  });
  assert.ok(result.error, 'expected the out-of-turn move to be refused');
});

test('a player cannot play a tile they do not hold', async () => {
  const { host, guest } = await seatedGame();
  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);

  const onTurn = view.turn === 0 ? host : view.turn === 1 ? guest : null;
  if (!onTurn) return; // a bot opens this deal; nothing to assert here

  const held = new Set(view.hand.map((t) => t.id));
  const notHeld = ['6-6', '5-5', '4-4', '3-3', '0-0'].find((id) => !held.has(id));

  const result = await post(`/api/rooms/${host.code}/action`, {
    token: onTurn.token,
    type: 'play',
    tileId: notHeld,
    end: 'open',
  });
  assert.ok(result.error, `expected ${notHeld} to be refused`);
});
