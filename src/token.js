import { randomBytes } from 'node:crypto'

/**
 * Generate a per-session token.
 *
 * Anything on this machine — any local process, and any web page you visit via
 * DNS-rebinding or a form post against 127.0.0.1 — could otherwise hit the API
 * and read the served tree. The token is generated at boot, injected into
 * index.html, and required by every /api/* request.
 */
export function generateToken () {
  return randomBytes(24).toString('hex')
}
