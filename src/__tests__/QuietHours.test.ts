import {
  hourInZone,
  isHourInWindow,
  isQuietHoursActive,
  tenantQuietHours,
} from '../services/quietHours';

describe('isHourInWindow', () => {
  it('handles a same-day window', () => {
    expect(isHourInWindow(9, 8, 17)).toBe(true);
    expect(isHourInWindow(8, 8, 17)).toBe(true);
    expect(isHourInWindow(17, 8, 17)).toBe(false);
    expect(isHourInWindow(7, 8, 17)).toBe(false);
  });

  it('handles a window that wraps midnight', () => {
    expect(isHourInWindow(22, 21, 8)).toBe(true);
    expect(isHourInWindow(2, 21, 8)).toBe(true);
    expect(isHourInWindow(8, 21, 8)).toBe(false);
    expect(isHourInWindow(20, 21, 8)).toBe(false);
  });

  it('treats start==end as never-active rather than always-active', () => {
    expect(isHourInWindow(12, 12, 12)).toBe(false);
  });
});

describe('hourInZone', () => {
  it('returns a 0-23 value for a valid timezone', () => {
    const h = hourInZone(new Date('2026-05-17T12:00:00Z'), 'Asia/Colombo');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });

  it('falls back to local hour when timezone is invalid', () => {
    const now = new Date();
    const h = hourInZone(now, 'Not/A_Zone');
    expect(h).toBe(now.getHours());
  });
});

describe('isQuietHoursActive', () => {
  it('returns false when no window is configured', () => {
    expect(isQuietHoursActive(undefined)).toBe(false);
  });

  it('returns false when window is explicitly disabled', () => {
    expect(
      isQuietHoursActive({ enabled: false, startHour: 21, endHour: 8 }),
    ).toBe(false);
  });

  it('returns true when current hour is inside the window', () => {
    // Construct a window covering the *current* hour so the test is
    // robust against clock drift.
    const h = new Date().getHours();
    const window = {
      enabled: true,
      startHour: h,
      endHour: (h + 1) % 24,
    };
    expect(isQuietHoursActive(window)).toBe(true);
  });
});

describe('tenantQuietHours', () => {
  it('returns undefined when the tenant has no quiet hours', () => {
    expect(tenantQuietHours(null)).toBeUndefined();
    expect(tenantQuietHours(undefined)).toBeUndefined();
    expect(tenantQuietHours({ quietHours: undefined, brand: {} } as any)).toBeUndefined();
  });

  it('returns undefined when the configured window is disabled', () => {
    expect(
      tenantQuietHours({
        quietHours: { enabled: false, startHour: 21, endHour: 8 },
        brand: {},
      } as any),
    ).toBeUndefined();
  });

  it('inherits brand.timezone when the window does not pin one', () => {
    const window = tenantQuietHours({
      quietHours: { enabled: true, startHour: 21, endHour: 8 },
      brand: { timezone: 'Asia/Colombo' },
    } as any);
    expect(window?.timezone).toBe('Asia/Colombo');
  });

  it('prefers the window timezone over brand.timezone', () => {
    const window = tenantQuietHours({
      quietHours: {
        enabled: true,
        startHour: 21,
        endHour: 8,
        timezone: 'Europe/London',
      },
      brand: { timezone: 'Asia/Colombo' },
    } as any);
    expect(window?.timezone).toBe('Europe/London');
  });
});
