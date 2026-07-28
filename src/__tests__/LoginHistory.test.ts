import mongoose from 'mongoose';
import {
  LOGIN_OUTCOMES,
  buildLoginHistoryFilter,
  describeOutcome,
  describeUserAgent,
  isLoginOutcome,
} from '../services/LoginHistoryService';

const TENANT = '507f1f77bcf86cd799439011';
const ADMIN = '507f191e810c19729de860ea';

describe('isLoginOutcome', () => {
  it('accepts every catalogued outcome', () => {
    for (const outcome of LOGIN_OUTCOMES) {
      expect(isLoginOutcome(outcome)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isLoginOutcome('succeeded')).toBe(false);
    expect(isLoginOutcome('')).toBe(false);
    expect(isLoginOutcome(undefined)).toBe(false);
    expect(isLoginOutcome({ $ne: null })).toBe(false);
  });
});

describe('describeOutcome', () => {
  it('renders each outcome as operator-facing text', () => {
    expect(describeOutcome('success')).toBe('Signed in');
    expect(describeOutcome('invalid_password')).toBe('Wrong password');
    expect(describeOutcome('unknown_user')).toBe('Unknown username');
    expect(describeOutcome('account_disabled')).toBe('Account disabled');
  });

  it('passes an unrecognised value through rather than blanking the cell', () => {
    expect(describeOutcome('something_new')).toBe('something_new');
  });
});

describe('describeUserAgent', () => {
  it('names common desktop browsers with their OS', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      ),
    ).toBe('Chrome on Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('Safari on macOS');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
      ),
    ).toBe('Firefox on Linux');
  });

  it('does not mistake Edge, Opera or Samsung Internet for Chrome', () => {
    // All three carry "Chrome/..." in their UA, so ordering is what makes
    // this correct rather than "everything is Chrome".
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0',
      ),
    ).toBe('Edge on Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/119.0 Safari/537.36 OPR/105.0',
      ),
    ).toBe('Opera on Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36',
      ),
    ).toBe('Samsung Internet on Android');
  });

  it('recognises mobile devices', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Version/17.2 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android');
  });

  it('flags non-browser clients, which is the interesting case', () => {
    expect(describeUserAgent('curl/8.4.0')).toBe('curl');
    expect(describeUserAgent('PostmanRuntime/7.36.0')).toBe('Postman');
  });

  it('handles a missing or unrecognisable agent without blanking', () => {
    expect(describeUserAgent(undefined)).toBe('Unknown device');
    expect(describeUserAgent('')).toBe('Unknown device');
    expect(describeUserAgent('   ')).toBe('Unknown device');
    expect(describeUserAgent('some-internal-agent/1.0')).toBe(
      'some-internal-agent/1.0',
    );
  });

  it('truncates a very long unrecognised agent', () => {
    const long = 'x'.repeat(200);
    const out = describeUserAgent(long);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildLoginHistoryFilter', () => {
  it('is empty when nothing is selected', () => {
    expect(buildLoginHistoryFilter({})).toEqual({});
  });

  it('scopes to one employee by id', () => {
    const filter = buildLoginHistoryFilter({ adminId: ADMIN });
    expect(String(filter.adminId)).toBe(ADMIN);
  });

  it('ignores an id that is not a valid ObjectId', () => {
    expect(buildLoginHistoryFilter({ adminId: 'not-an-id' })).toEqual({});
  });

  it('matches a username case-insensitively and escapes the pattern', () => {
    const filter = buildLoginHistoryFilter({ username: 'a.b*c' }) as any;
    expect(filter.username.$regex).toBe('a\\.b\\*c');
    expect(filter.username.$options).toBe('i');
  });

  it('filters to a single outcome', () => {
    expect(buildLoginHistoryFilter({ outcome: 'success' }).outcome).toBe(
      'success',
    );
  });

  it('drops an outcome that is not in the catalogue', () => {
    expect(
      buildLoginHistoryFilter({ outcome: 'made_up' }).outcome,
    ).toBeUndefined();
  });

  it('failuresOnly wins over a specific outcome', () => {
    const filter = buildLoginHistoryFilter({
      failuresOnly: true,
      outcome: 'success',
    });
    expect(filter.outcome).toEqual({ $ne: 'success' });
  });

  it('builds open-ended and closed time windows', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-07-31T23:59:59.999Z');
    expect(buildLoginHistoryFilter({ from }).createdAt).toEqual({ $gte: from });
    expect(buildLoginHistoryFilter({ to }).createdAt).toEqual({ $lte: to });
    expect(buildLoginHistoryFilter({ from, to }).createdAt).toEqual({
      $gte: from,
      $lte: to,
    });
  });

  it('keeps tenant-less rows visible to the workspace', () => {
    // An unknown-username attempt has no tenant to stamp; dropping those
    // would hide exactly the rows an operator most wants to see.
    const filter = buildLoginHistoryFilter({ tenantId: TENANT }) as any;
    expect(filter.$or).toHaveLength(3);
    expect(String(filter.$or[0].tenantId)).toBe(TENANT);
    expect(filter.$or[1]).toEqual({ tenantId: { $exists: false } });
    expect(filter.$or[2]).toEqual({ tenantId: null });
  });

  it('applies no tenant clause for a super admin', () => {
    expect(buildLoginHistoryFilter({ tenantId: null }).$or).toBeUndefined();
  });

  it('combines every selection at once', () => {
    const filter = buildLoginHistoryFilter({
      adminId: ADMIN,
      failuresOnly: true,
      from: new Date('2026-07-01T00:00:00.000Z'),
      tenantId: TENANT,
    }) as any;
    expect(filter.adminId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(filter.outcome).toEqual({ $ne: 'success' });
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    expect(filter.$or).toHaveLength(3);
  });
});
