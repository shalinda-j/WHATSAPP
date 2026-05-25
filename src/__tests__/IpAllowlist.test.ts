import {
  ipMatchesEntry,
  isIpAllowed,
  clientIpFromRequest,
} from '../services/ipAllowlist';

describe('ipMatchesEntry', () => {
  it('matches an exact IPv4 address', () => {
    expect(ipMatchesEntry('203.0.113.42', '203.0.113.42')).toBe(true);
    expect(ipMatchesEntry('203.0.113.42', '203.0.113.43')).toBe(false);
  });

  it('matches inside a /24 CIDR', () => {
    expect(ipMatchesEntry('203.0.113.1', '203.0.113.0/24')).toBe(true);
    expect(ipMatchesEntry('203.0.113.255', '203.0.113.0/24')).toBe(true);
    expect(ipMatchesEntry('203.0.114.0', '203.0.113.0/24')).toBe(false);
  });

  it('matches inside a /16 CIDR', () => {
    expect(ipMatchesEntry('10.0.5.7', '10.0.0.0/16')).toBe(true);
    expect(ipMatchesEntry('10.1.0.1', '10.0.0.0/16')).toBe(false);
  });

  it('treats /0 as global match', () => {
    expect(ipMatchesEntry('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('rejects malformed CIDR + malformed IPs', () => {
    expect(ipMatchesEntry('203.0.113.1', '203.0.113.0/33')).toBe(false);
    expect(ipMatchesEntry('not-an-ip', '203.0.113.0/24')).toBe(false);
    expect(ipMatchesEntry('203.0.113.1', '203.0.113.0/-1')).toBe(false);
  });

  it('unwraps IPv4-mapped IPv6 (::ffff:1.2.3.4)', () => {
    expect(ipMatchesEntry('::ffff:203.0.113.42', '203.0.113.42')).toBe(true);
    expect(ipMatchesEntry('::ffff:203.0.113.1', '203.0.113.0/24')).toBe(true);
  });
});

describe('isIpAllowed', () => {
  it('allows everything when the list is empty / undefined', () => {
    expect(isIpAllowed('1.2.3.4', undefined)).toBe(true);
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('rejects when the IP is empty and the list has entries', () => {
    expect(isIpAllowed('', ['203.0.113.0/24'])).toBe(false);
  });

  it('allows when at least one entry matches', () => {
    expect(isIpAllowed('203.0.113.5', ['10.0.0.0/8', '203.0.113.0/24'])).toBe(
      true,
    );
  });
});

describe('clientIpFromRequest', () => {
  it('prefers the first hop in x-forwarded-for', () => {
    expect(
      clientIpFromRequest({
        headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' },
        ip: '10.0.0.1',
      }),
    ).toBe('203.0.113.42');
  });

  it('falls back to req.ip when xff is missing', () => {
    expect(clientIpFromRequest({ headers: {}, ip: '10.0.0.1' })).toBe(
      '10.0.0.1',
    );
  });

  it('falls back to socket.remoteAddress as the last resort', () => {
    expect(
      clientIpFromRequest({
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      }),
    ).toBe('127.0.0.1');
  });
});
