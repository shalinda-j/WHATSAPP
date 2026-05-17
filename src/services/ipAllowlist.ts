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

export function isIpAllowed(ip: string, allowlist: string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return true; // open by default
  if (!ip) return false;
  return allowlist.some((e) => ipMatchesEntry(ip, e));
}

/**
 * Reads the client IP using the standard hierarchy: x-forwarded-for first
 * (proxied deployments), then Express's resolved req.ip, then the raw
 * socket address. Returns the first non-empty value.
 */
export function clientIpFromRequest(req: {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  const xff = (req.headers?.['x-forwarded-for'] ?? '') as string;
  if (xff && typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || '';
}
