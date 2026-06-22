import {
  pickRecipientHandle,
  weightedPickVariantId,
  isInQuietHours,
  stripJsonFences,
} from '../services/CampaignService';

describe('pickRecipientHandle', () => {
  it('builds a WhatsApp JID from whatsappNumber', () => {
    const out = pickRecipientHandle(
      { whatsappNumber: '+94 77 123 4567' },
      'whatsapp',
    );
    expect(out).toBe('94771234567@s.whatsapp.net');
  });

  it('falls back to whatsappId then phone for WhatsApp', () => {
    expect(pickRecipientHandle({ whatsappId: '94771234567' }, 'whatsapp')).toBe(
      '94771234567@s.whatsapp.net',
    );
    expect(pickRecipientHandle({ phone: '+94-77-123-4567' }, 'whatsapp')).toBe(
      '94771234567@s.whatsapp.net',
    );
  });

  it('returns undefined for WhatsApp when no usable field is present', () => {
    expect(pickRecipientHandle({}, 'whatsapp')).toBeUndefined();
    expect(
      pickRecipientHandle({ whatsappNumber: '++--' }, 'whatsapp'),
    ).toBeUndefined();
    expect(
      pickRecipientHandle({ whatsappNumber: '29141520924734@lid' }, 'whatsapp'),
    ).toBeUndefined();
  });

  it('returns email verbatim for the email channel', () => {
    expect(pickRecipientHandle({ email: 'a@b.com' }, 'email')).toBe('a@b.com');
    expect(pickRecipientHandle({}, 'email')).toBeUndefined();
  });

  it('returns undefined for channels without a Contact handle field', () => {
    expect(
      pickRecipientHandle({ phone: '94771234567' }, 'telegram'),
    ).toBeUndefined();
    expect(
      pickRecipientHandle({ email: 'a@b.com' }, 'instagram'),
    ).toBeUndefined();
  });
});

describe('weightedPickVariantId', () => {
  it('returns undefined for empty variant list', () => {
    expect(weightedPickVariantId([])).toBeUndefined();
  });

  it('returns the only variant when only one exists', () => {
    expect(weightedPickVariantId([{ variantId: 'A', weight: 100 }])).toBe('A');
  });

  it('returns one of the variants given any input', () => {
    const variants = [
      { variantId: 'A', weight: 50 },
      { variantId: 'B', weight: 50 },
    ];
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const picked = weightedPickVariantId(variants);
      if (picked) ids.add(picked);
    }
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(['A', 'B']).toContain(id);
  });

  it('falls back gracefully when total weight is zero', () => {
    const out = weightedPickVariantId([
      { variantId: 'A', weight: 0 },
      { variantId: 'B', weight: 0 },
    ]);
    expect(out).toBe('A');
  });
});

describe('isInQuietHours', () => {
  it('returns false when no quiet hours are configured', () => {
    expect(isInQuietHours({ quietHours: undefined } as any)).toBe(false);
  });

  it('returns true within a same-day window (09:00 - 17:00)', () => {
    const campaign = { quietHours: { startHour: 9, endHour: 17 } } as any;
    const noon = new Date('2026-05-15T12:00:00');
    const seven = new Date('2026-05-15T07:00:00');
    expect(isInQuietHours(campaign, undefined, noon)).toBe(true);
    expect(isInQuietHours(campaign, undefined, seven)).toBe(false);
  });

  it('handles wrap-midnight windows correctly (22:00 - 08:00)', () => {
    const campaign = { quietHours: { startHour: 22, endHour: 8 } } as any;
    const eleven = new Date('2026-05-15T23:00:00');
    const six = new Date('2026-05-15T06:00:00');
    const noon = new Date('2026-05-15T12:00:00');
    expect(isInQuietHours(campaign, undefined, eleven)).toBe(true);
    expect(isInQuietHours(campaign, undefined, six)).toBe(true);
    expect(isInQuietHours(campaign, undefined, noon)).toBe(false);
  });

  it('returns false when start/end fields are missing or malformed', () => {
    expect(
      isInQuietHours(
        { quietHours: { startHour: 9 } } as any,
        undefined,
        new Date('2026-05-15T12:00:00'),
      ),
    ).toBe(false);
    expect(
      isInQuietHours(
        { quietHours: { startHour: '9', endHour: '17' } } as any,
        undefined,
        new Date('2026-05-15T12:00:00'),
      ),
    ).toBe(false);
  });
});

describe('stripJsonFences', () => {
  it('returns plain JSON unchanged', () => {
    expect(stripJsonFences('{"a":1}')).toBe('{"a":1}');
  });

  it('strips ```json fences', () => {
    const fenced = '```json\n{"a":1}\n```';
    expect(stripJsonFences(fenced)).toBe('{"a":1}');
  });

  it('strips ``` (no language) fences', () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('trims surrounding whitespace', () => {
    expect(stripJsonFences('   {"a":1}\n')).toBe('{"a":1}');
  });
});
