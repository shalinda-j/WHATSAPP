import { MAX_VALID_DAYS, parseValidDays } from '../server/routes/kiosk-admin';
import { buildSeedCollected } from '../services/KioskInviteService';

/**
 * Manual kiosk-code generation, from the Consulting Assistant page.
 *
 * Codes used to come from one place: the CRM "Issue code" button, which always
 * had a Contact or a phone number to work from. A walk-in at the counter has
 * neither, so the operator now fills in a short form instead. These cover the
 * two pure pieces that sit either side of that — how long the code lives, and
 * what the consultant is told before the visitor says a word.
 */

describe('parseValidDays', () => {
  it('falls back to the service default when nothing is chosen', () => {
    // Returning undefined (not a computed date) matters: the default code
    // lifetime should live in exactly one place, in the service.
    expect(parseValidDays(undefined)).toEqual({});
    expect(parseValidDays(null)).toEqual({});
    expect(parseValidDays('')).toEqual({});
  });

  it('converts a day count into a future expiry', () => {
    const before = Date.now();
    const { expiresAt, error } = parseValidDays(1);
    expect(error).toBeUndefined();
    expect(expiresAt).toBeInstanceOf(Date);
    const ms = (expiresAt as Date).getTime() - before;
    // One day, allowing for the clock ticking during the call.
    expect(ms).toBeGreaterThan(23.9 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(24.1 * 60 * 60 * 1000);
  });

  it('accepts a numeric string, since a form field yields text', () => {
    expect(parseValidDays('7').expiresAt).toBeInstanceOf(Date);
  });

  it('rejects zero and negatives rather than issuing a dead code', () => {
    // A past expiry would create a code that can never be redeemed — the
    // operator would hand it over and the visitor would be turned away.
    expect(parseValidDays(0).error).toBeTruthy();
    expect(parseValidDays(-3).error).toBeTruthy();
    expect(parseValidDays(0).expiresAt).toBeUndefined();
  });

  it('rejects nonsense instead of producing an Invalid Date', () => {
    expect(parseValidDays('soon').error).toBeTruthy();
    expect(parseValidDays(Number.NaN).error).toBeTruthy();
    expect(parseValidDays(Infinity).error).toBeTruthy();
  });

  it('caps how long a code can stay alive', () => {
    // A code is a key to somebody's consultation, including their WhatsApp
    // history. An indefinite one left in a drawer is a standing risk.
    expect(parseValidDays(MAX_VALID_DAYS).error).toBeUndefined();
    expect(parseValidDays(MAX_VALID_DAYS + 1).error).toBeTruthy();
  });
});

describe('buildSeedCollected', () => {
  it('returns undefined when the operator supplied nothing', () => {
    // The caller omits the field entirely so the schema default applies —
    // writing `{ personal: {} }` would be an empty shell.
    expect(buildSeedCollected({})).toBeUndefined();
    expect(
      buildSeedCollected({ name: '', phone: '', course: '' }),
    ).toBeUndefined();
    expect(buildSeedCollected({ name: '   ' })).toBeUndefined();
  });

  it('seeds the name so the consultant opens knowing who it is talking to', () => {
    expect(buildSeedCollected({ name: 'Nimal Perera' })).toEqual({
      personal: { fullName: 'Nimal Perera' },
    });
  });

  it('trims what the operator typed', () => {
    expect(buildSeedCollected({ name: '  Nimal  ', course: ' IT  ' })).toEqual({
      personal: { fullName: 'Nimal' },
      course: { program: 'IT' },
    });
  });

  it('keeps personal and course in the shape the consultant already merges', () => {
    expect(
      buildSeedCollected({
        name: 'Nimal',
        phone: '0771234567',
        course: 'IT Diploma',
      }),
    ).toEqual({
      personal: { fullName: 'Nimal', mobile: '0771234567' },
      course: { program: 'IT Diploma' },
    });
  });

  it('never invents a field it was not given', () => {
    // computeCompleted() treats a present leaf as captured, so a blank value
    // here would make the consultant skip asking for something it never
    // actually learned — and the visit could be marked complete without a NIC
    // or a payment ever being confirmed.
    const seeded = buildSeedCollected({ name: 'Nimal' });
    expect(seeded?.personal).not.toHaveProperty('nic');
    expect(seeded?.personal).not.toHaveProperty('mobile');
    expect(seeded).not.toHaveProperty('payment');
  });

  it('omits the course section entirely when no course was given', () => {
    const seeded = buildSeedCollected({ name: 'Nimal', phone: '077' });
    expect(seeded).not.toHaveProperty('course');
  });
});
