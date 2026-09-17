// The entry point: the one file whose job is to actually listen.
//
// server.js deliberately does not start itself. It used to, guarded by
// comparing process.argv[1] against its own path — which silently does nothing
// under any launcher that imports the script rather than running it directly
// (pm2's fork mode, for one). The process comes up, reports itself healthy, and
// serves nothing. An explicit entry point cannot fail that way.

import { start } from './server.js';

const server = await start();
const { port } = server.address();

console.log(`Partner Dominoes listening on port ${port}`);
