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

/**
 * Hold a player's stream open, collecting every state it receives. Needed for
 * anything involving `connected`, which only becomes true while subscribed.
 */
function openStream(path) {
  const controller = new AbortController();
  const views = [];
  const waiters = [];
  // A cursor, not just a waiter list: events land while the caller is awaiting
  // a POST, and a waiter registered afterwards would miss them and then block
  // on an event the server has no reason to send.
  let cursor = 0;

  (async () => {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const view = JSON.parse(line.slice(6));
          views.push(view);
          for (const waiter of waiters.splice(0)) waiter(view);
        }
      }
    } catch {
      // aborted by close()
    }
  })();

  return {
    views,
    next: () =>
      cursor < views.length
        ? Promise.resolve(views[cursor++])
        : new Promise((resolve) =>
            waiters.push((view) => {
              cursor = views.length;
              resolve(view);
            }),
          ),
    latest: () => views[views.length - 1],
    close: () => controller.abort(),
  };
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

test('the second person at a table is seated as the first one’s partner', async () => {
  const host = await post('/api/rooms', { name: 'Freeman' });
  const guest = await post(`/api/rooms/${host.code}/join`, { name: 'Ada' });

  // Seats alternate between teams, so "next free seat" would make them
  // opponents. People who arrive together want to play together.
  assert.equal(guest.seat, 2, 'seated across from the host');
  assert.equal(host.seat % 2, guest.seat % 2, 'same team');
});

test('the third and fourth players fill the opposing seats', async () => {
  const host = await post('/api/rooms', { name: 'A' });
  const second = await post(`/api/rooms/${host.code}/join`, { name: 'B' });
  const third = await post(`/api/rooms/${host.code}/join`, { name: 'C' });
  const fourth = await post(`/api/rooms/${host.code}/join`, { name: 'D' });

  assert.deepEqual([host.seat, second.seat, third.seat, fourth.seat], [0, 2, 1, 3]);
  assert.equal(third.seat % 2, fourth.seat % 2, 'the later pair are partners too');
});

test('a fifth player is refused', async () => {
  const host = await post('/api/rooms', { name: 'A' });
  for (const name of ['B', 'C', 'D']) {
    await post(`/api/rooms/${host.code}/join`, { name });
  }
  const fifth = await post(`/api/rooms/${host.code}/join`, { name: 'E' });
  assert.ok(fifth.error);
});

test('the host can rearrange the seating, and hosting follows them', async () => {
  const host = await post('/api/rooms', { name: 'Freeman' });
  const guest = await post(`/api/rooms/${host.code}/join`, { name: 'Ada' });

  const moved = await post(`/api/rooms/${host.code}/arrange`, {
    token: host.token,
    from: 0,
    to: 1,
  });
  assert.ok(moved.ok);

  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  assert.equal(view.seat, 1, 'the host moved to seat 1');
  assert.equal(view.hostSeat, 1, 'and is still the host there');
  assert.equal(view.players[1].name, 'Freeman');
  assert.equal(view.players[2].name, 'Ada');
  // They are now opponents, which is the point of being able to rearrange.
  assert.notEqual(1 % 2, guest.seat % 2);
});

test('an open stream follows its player when the seating changes', async () => {
  // Regression: subscribers used to cache their seat number at connect time, so
  // after a swap a player kept being rendered — and dealt — as their old seat.
  const host = await post('/api/rooms', { name: 'Freeman' });
  const guest = await post(`/api/rooms/${host.code}/join`, { name: 'Ada' });

  const stream = openStream(`/api/rooms/${host.code}/stream?token=${host.token}`);
  const first = await stream.next();
  assert.equal(first.seat, 0);

  await post(`/api/rooms/${host.code}/arrange`, {
    token: host.token,
    from: 0,
    to: 1,
  });

  let moved = await stream.next();
  while (moved.seat === 0) moved = await stream.next();

  assert.equal(moved.seat, 1, 'the live stream reports the new seat');
  assert.equal(moved.hostSeat, 1, 'and they are still the host');

  // And the hand dealt to that stream is the one for the seat they now hold.
  await post(`/api/rooms/${host.code}/start`, { token: host.token });
  let playing = await stream.next();
  while (playing.phase !== 'playing') playing = await stream.next();

  assert.equal(playing.seat, 1);
  assert.equal(playing.hand.length, 7);

  const theirs = await firstEvent(
    `/api/rooms/${host.code}/stream?token=${guest.token}`,
  );
  const mine = playing.hand.map((t) => t.id);
  const others = theirs.hand.map((t) => t.id);
  assert.equal(
    mine.filter((id) => others.includes(id)).length,
    0,
    'the two players hold different tiles',
  );

  stream.close();
});

test('only the host can rearrange, and only before the game starts', async () => {
  const host = await post('/api/rooms', { name: 'Freeman' });
  const guest = await post(`/api/rooms/${host.code}/join`, { name: 'Ada' });

  const refused = await post(`/api/rooms/${host.code}/arrange`, {
    token: guest.token,
    from: 0,
    to: 1,
  });
  assert.ok(refused.error);

  await post(`/api/rooms/${host.code}/start`, { token: host.token });
  const tooLate = await post(`/api/rooms/${host.code}/arrange`, {
    token: host.token,
    from: 0,
    to: 1,
  });
  assert.ok(tooLate.error, 'refused once play has begun');
});

test('a name is optional, and falls back to the seat number', async () => {
  const host = await post('/api/rooms', {});
  const guest = await post(`/api/rooms/${host.code}/join`, { name: '   ' });

  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  assert.equal(view.players[host.seat].name, 'Player 1');
  assert.equal(view.players[guest.seat].name, `Player ${guest.seat + 1}`);
});

test('a player can set and change their name at any point', async () => {
  const host = await post('/api/rooms', {});

  await post(`/api/rooms/${host.code}/name`, { token: host.token, name: 'Freeman' });
  let view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  assert.equal(view.players[0].name, 'Freeman');

  await post(`/api/rooms/${host.code}/name`, { token: host.token, name: '  Ada  ' });
  view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  assert.equal(view.players[0].name, 'Ada', 'trimmed');

  // Clearing it returns to the fallback rather than leaving a blank at the table.
  await post(`/api/rooms/${host.code}/name`, { token: host.token, name: '' });
  view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  assert.equal(view.players[0].name, 'Player 1');
});

test('a name cannot be set by someone not at the table', async () => {
  const host = await post('/api/rooms', {});
  const result = await post(`/api/rooms/${host.code}/name`, {
    token: 'not-a-real-token',
    name: 'Impostor',
  });
  assert.ok(result.error);
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
  // The two humans are partners at 0 and 2, so the bots take 1 and 3.
  const kinds = view.players.map((p) => p.kind);
  assert.deepEqual(kinds, ['human', 'bot', 'human', 'bot']);
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

// ------------------------------------------------------------ partner pause

test('play halts after a bot partner moves, until the human proceeds', async () => {
  const host = await post('/api/rooms', { name: 'Freeman' });
  const stream = openStream(`/api/rooms/${host.code}/stream?token=${host.token}`);
  await stream.next(); // the lobby, which also marks the host connected
  await post(`/api/rooms/${host.code}/start`, { token: host.token });

  let sawPause = false;
  let resumed = false;
  const deadline = Date.now() + 25_000;

  while (Date.now() < deadline && !(sawPause && resumed)) {
    const view = await Promise.race([
      stream.next(),
      new Promise((r) => setTimeout(() => r(null), 6000)),
    ]);
    if (!view) break;
    if (view.phase !== 'playing') continue;

    if (view.pause) {
      assert.equal(view.pause.seat, 0, 'the table waits on the human');
      assert.equal(view.pause.by, 2, 'because their partner moved');
      sawPause = true;

      // Nothing may happen while the table is held.
      const blocked = await post(`/api/rooms/${host.code}/action`, {
        token: host.token,
        type: 'pass',
      });
      assert.ok(blocked.error, 'moves are refused while paused');

      await post(`/api/rooms/${host.code}/proceed`, { token: host.token });
      continue;
    }

    if (sawPause) resumed = true;

    if (view.turn === 0 && view.legalMoves.length > 0) {
      const move = view.legalMoves[0];
      await post(`/api/rooms/${host.code}/action`, {
        token: host.token,
        type: 'play',
        tileId: move.tileId,
        end: move.end,
      });
    }
  }

  stream.close();
  assert.ok(sawPause, 'the table paused after the bot partner moved');
  assert.ok(resumed, 'and carried on once acknowledged');
});

test('two partnered humans never trigger the pause', async () => {
  // With both people on one team the bots partner each other, so there is
  // nobody the pause would be for.
  const host = await post('/api/rooms', { name: 'Freeman' });
  const guest = await post(`/api/rooms/${host.code}/join`, { name: 'Ada' });
  assert.equal(host.seat % 2, guest.seat % 2, 'the humans are partners');

  const view = await firstEvent(`/api/rooms/${host.code}/stream?token=${host.token}`);
  const bots = view.players.filter((p) => p.kind !== 'human');
  assert.equal(bots.length, 2);
});

test('proceeding when nothing is paused is refused', async () => {
  const { host } = await seatedGame();
  const result = await post(`/api/rooms/${host.code}/proceed`, { token: host.token });
  assert.ok(result.error);
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
