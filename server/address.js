// The address other devices can reach this server on.
//
// The host almost always has the game open at localhost, so an invite link
// built from the browser's own origin would send a phone to its own loopback
// and fail. The server knows better: it can see its network interfaces.

import { networkInterfaces } from 'node:os';

let port = null;

export function setPort(value) {
  port = value;
}

/**
 * The first non-internal IPv4 origin, or null when there is no network to be
 * reached on. IPv6 is skipped deliberately: a link-local v6 address in a QR
 * code is not something a phone camera will do anything useful with.
 */
export function lanOrigin() {
  if (!port) return null;

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        return `http://${address.address}:${port}`;
      }
    }
  }
  return null;
}
