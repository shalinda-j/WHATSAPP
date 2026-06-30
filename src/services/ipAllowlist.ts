/**
 * IPv4 CIDR / exact-match allowlist matcher. Intentionally tiny — every
 * authenticated admin call hits this on the hot path so a 4-line bitwise
 * test beats pulling in `ipaddr.js` or `netmask` for the same job.
 *
 * Supported entry forms:
 *   '203.0.113.42'         → exact match
 *   '203.0.113.0/24'       → CIDR
 *   '203.0.113.0/255.255.255.0' → not supported (use /24 form)
 *   IPv6                   → falls through to exact-string match only
 *
 * IPv6 strict matching keeps this dependency-free; tenants who need full
 * IPv6 CIDR support can land it incrementally once a customer asks.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const oct = Number(part);
    if (!Number.isInteger(oct) || oct < 0 || oct > 255) return null;
    n = (n << 8) | oct;
  }
  return n >>> 0; // force unsigned
}

function normaliseIp(ip: string): string {
  // Express may surface IPv4-mapped IPv6 ('::ffff:1.2.3.4'); unwrap so the
  // operator can write a clean IPv4 allowlist without remembering the
  // prefix. Trim ports too in case `req.socket.remoteAddress` includes one.
  let s = ip.trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  const portIdx = s.lastIndexOf(':');
  if (portIdx > 0 && s.indexOf('.') > 0) s = s.slice(0, portIdx);
  return s;
}

export function ipMatchesEntry(rawIp: string, entry: string): boolean {
  const ip = normaliseIp(rawIp);
  const e = entry.trim();
  if (e === ip) return true;

  // CIDR check (IPv4 only).
  if (e.includes('/')) {
    const [base, bitsStr] = e.split('/');
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const ipInt = ipv4ToInt(ip);
    const baseInt = ipv4ToInt(base);
    if (ipInt === null || baseInt === null) return false;
    if (bits === 0) return true; // 0.0.0.0/0 matches every IPv4
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  }

  return false;
}

export function isIpAllowed(
  ip: string,
  allowlist: string[] | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) return true; // open by default
  if (!ip) return false;
  return allowlist.some((e) => ipMatchesEntry(ip, e));
}

/**
 * Reads the client IP for security decisions (the IP allowlist).
 *
 * SECURITY: the leftmost X-Forwarded-For token is whatever the *external*
 * client chose to send, so it must never be trusted for access control —
 * an attacker could spoof `X-Forwarded-For: <allowlisted-ip>` and bypass
 * the allowlist. Express resolves `req.ip` correctly from the right end of
 * XFF using the app-level `trust proxy` hop count (set to 1 in app.ts), so
 * we prefer it. Only when `req.ip` is absent (non-Express callers) do we
 * fall back to the LAST XFF entry — the one appended by the closest hop —
 * never the unvalidated first token, then the raw socket address.
 */
export function clientIpFromRequest(req: {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  if (req.ip) return req.ip;
  const xff = (req.headers?.['x-forwarded-for'] ?? '') as string;
  if (xff && typeof xff === 'string') {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.socket?.remoteAddress || '';
}
