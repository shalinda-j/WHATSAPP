import { sanitizeBookingReply } from '../utils/sanitizeBookingReply';

describe('sanitizeBookingReply — strips fabricated kiosk codes', () => {
  it('removes the exact hallucinated confirmation from the field', () => {
    const reply =
      'Hari Shalinda Miss, appointment eka note karala thiyenawa.\n' +
      '🔢 Voice Consult Code: 1234\n' +
      'Shakawata aapu dawase kiosk thiraye me code eka type karala apey AI upadeshaka samaga katha karanna puluwan. Enakota certificates / ID copy thiyenawa nam aragena enna.';
    const out = sanitizeBookingReply(reply);
    expect(out).not.toMatch(/1234/);
    expect(out.toLowerCase()).not.toContain('voice consult');
    expect(out.toLowerCase()).not.toContain('🔢');
    // The kiosk-code instruction line is also gone.
    expect(out.toLowerCase()).not.toMatch(/kiosk.*code/);
  });

  it('strips various code phrasings', () => {
    expect(sanitizeBookingReply('Your code: 4024')).not.toMatch(/4024/);
    expect(sanitizeBookingReply('Consult Code - 9883 ready')).not.toMatch(
      /9883/,
    );
    expect(sanitizeBookingReply('kiosk eke code eka 6173')).not.toMatch(/6173/);
  });

  it('leaves normal replies untouched', () => {
    const normal =
      'Supiri! 🙌 Oyaට free campus visit ekak set karala denna mama. Weekdays හරිද weekend හරිද lehesi?';
    expect(sanitizeBookingReply(normal)).toBe(normal);
  });

  it('does not strip ordinary numbers that are not codes', () => {
    const withTime = 'Enna puluwan 9.30 ට. Address eka: No 45, Pasyala.';
    expect(sanitizeBookingReply(withTime)).toBe(withTime);
  });

  it('handles empty input', () => {
    expect(sanitizeBookingReply('')).toBe('');
  });
});
