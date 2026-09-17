// HTTP server: static files, a small JSON API, and a server-sent-event stream
// per player.
//
// No dependencies. Turn-based play needs no WebSocket — the server pushes state
// over SSE and clients post their moves back, which keeps the whole project
// installable with nothing but Node itself.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRoom,
  joinRoom,
  getRoom,
  seatOf,
  startGame,
  act,
  ready,
  arrange,
  proceed,
  subscribe,
  heartbeat,
  collectIdleRooms,
} from './rooms.js';
import { viewFor } from './protocol.js';
import { setPort } from './address.js';

// Not `Number(env.PORT) || 8000`: port 0 is meaningful — it asks the OS for a
// free one — and it is also falsy, so that idiom quietly turns it into 8000.
const PORT = process.env.PORT === undefined ? 8000 : Number(process.env.PORT);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_000) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Serve a file from the project, refusing anything that escapes the root. */
async function serveStatic(req, res, pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const target = join(ROOT, relative === '/' || relative === sep ? 'index.html' : relative);

  if (!target.startsWith(ROOT)) {
    return json(res, 403, { error: 'Forbidden' });
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

/** Resolve `{ room, seat }` from a room code plus a player token. */
function authenticate(code, token) {
  const room = getRoom(code);
  if (!room) return { error: 'No table with that code.' };
  const seat = seatOf(room, token);
  if (seat === -1) return { error: 'You are not seated at that table.' };
  return { room, seat };
}

function openStream(req, res, room, token) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  // Headers are already out, so an error here cannot be turned into a JSON
  // response. End the stream instead — a client that hangs on a half-open
  // connection is far worse to debug than one that sees it close.
  try {
    const unsubscribe = subscribe(room, token, res);
    req.on('close', unsubscribe);
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (!path.startsWith('/api/')) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, path);
  }

  try {
    // POST /api/rooms — open a new table.
    if (path === '/api/rooms' && req.method === 'POST') {
      const { name } = await readJsonBody(req);
      const { room, token, seat } = createRoom(name);
      return json(res, 200, { code: room.code, token, seat });
    }

    const match = path.match(
      /^\/api\/rooms\/([A-Za-z0-9]{4})\/(join|start|action|ready|arrange|proceed|stream)$/,
    );
    if (!match) return json(res, 404, { error: 'Not found' });

    const [, code, action] = match;

    if (action === 'join' && req.method === 'POST') {
      const { name } = await readJsonBody(req);
      const result = joinRoom(code, name);
      if (result.error) return json(res, 400, result);
      return json(res, 200, { code: result.room.code, token: result.token, seat: result.seat });
    }

    // The stream carries the token in the query string because EventSource
    // cannot set headers.
    if (action === 'stream' && req.method === 'GET') {
      const room = getRoom(code);
      if (!room) return json(res, 404, { error: 'No table with that code.' });
      return openStream(req, res, room, url.searchParams.get('token'));
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

    const body = await readJsonBody(req);
    const auth = authenticate(code, body.token);
    if (auth.error) return json(res, 403, auth);

    const { room, seat } = auth;
    const result =
      action === 'start'
        ? startGame(room, seat)
        : action === 'ready'
          ? ready(room, seat)
          : action === 'arrange'
            ? arrange(room, seat, body.from, body.to)
            : action === 'proceed'
              ? proceed(room, seat)
              : act(room, seat, body);

    if (result.error) return json(res, 400, result);
    return json(res, 200, { ok: true, state: viewFor(room, seat) });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
});

// Keep proxies from closing idle streams, and tidy abandoned tables.
setInterval(heartbeat, 25_000).unref();
setInterval(collectIdleRooms, 5 * 60_000).unref();

/** Listen, resolving once bound. Port 0 picks a free one, which tests use. */
export function start(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      setPort(server.address().port);
      resolve(server);
    });
  });
}

export { server };

// Nothing here starts itself: server/main.js is the entry point. Guarding a
// self-start on process.argv[1] looked equivalent and was not — under a
// launcher that imports rather than executes (pm2 fork mode), the comparison
// quietly fails and the process serves nothing while reporting itself healthy.
