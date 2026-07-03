/**
 * Shared CORS origin helpers for the REST API (app.ts) and the Socket.io
 * handshake (socket.ts) so both apply the SAME allow rules.
 *
 * Why this exists: the admin panel (built client) is served BY this same
 * service, so its browser requests carry the app's own DigitalOcean App
 * Platform origin (`https://<app>.ondigitalocean.app`). ALLOWED_ORIGINS is
 * supposed to list that origin, but the live deployment's env drifted from
 * `.do/app.yaml` (the var was never set on the app), so the origin was
 * absent from the allowlist. REST calls still worked because browsers don't
 * enforce CORS on same-origin requests, but Socket.io performs its OWN
 * server-side origin check and rejected the handshake — silently breaking
 * every real-time dashboard feature (live chat, session/QR status, agent
 * traces). Allowing the platform origin here self-heals that drift; auth
 * (JWT for sockets, bearer token for REST) still gates real access.
 */

/**
 * True when `origin` is a DigitalOcean App Platform URL
 * (`https://something.ondigitalocean.app`). Malformed origins return false.
 */
export function isDigitalOceanOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === 'https:' && hostname.endsWith('.ondigitalocean.app');
  } catch {
    return false;
  }
}
