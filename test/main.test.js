// Does the thing we actually deploy actually serve?
//
// Every other server test imports `start()` directly, which is exactly how a
// broken entry point escapes notice: the module works perfectly, the process
// launched in production serves nothing, and pm2 still reports it online. This
// launches `npm start` the way a process manager does and checks the port.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = new URL('..', import.meta.url).pathname;

test('the entry point listens and serves', async () => {
  const child = spawn(process.execPath, ['server/main.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0' }, // an ephemeral port, so tests never clash
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error(`no port announced; output was: ${output || '(silence)'}`)),
        10_000,
      );
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/listening on port (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`exited with ${code} before listening: ${output}`));
      });
    });

    const page = await fetch(`http://localhost:${port}/`);
    assert.equal(page.status, 200, 'serves the game');

    const room = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'smoke test' }),
    }).then((r) => r.json());
    assert.match(room.code, /^[A-Z0-9]{4}$/, 'the API works');
  } finally {
    // Waiting on 'exit' from an already-exited child waits forever, which is
    // how a failing assertion turns into a hung test run.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
});
