/**
 * Strip fabricated kiosk / voice-consult codes (and the confirmation line that
 * carries them) out of an LLM-generated reply.
 *
 * WHY: real kiosk / voice-consult codes are ONLY ever issued by BookingService
 * (finalizeBooking / createDirectBooking via kioskInviteService) and delivered
 * through their own confirmation message. An agent or the generic AI has no way
 * to mint a real code — so any "Voice Consult Code: 1234" it writes in free
 * text is a hallucination. In the field a customer was told "appointment noted,
 * Voice Consult Code: 1234" while NO booking existed and the calendar stayed
 * empty; they'd type a dead code at the branch kiosk. This removes those lines
 * defensively so a model can never hand out a fake code.
 *
 * It intentionally does NOT touch real confirmations, because those are sent by
 * BookingService directly (never routed through this sanitizer).
 */

function isFabricatedCodeLine(line: string): boolean {
  const l = line.toLowerCase();
  if (line.includes('🔢')) return true;
  if (/voice\s*consult/.test(l)) return true;
  if (/consult\s*code/.test(l)) return true;
  // A "kiosk ... code" instruction line (real one comes from BookingService).
  if (l.includes('kiosk') && l.includes('code')) return true;
  // "code: 1234", "code - 4024", "code #9883" etc.
  if (/\bcode\b[^0-9a-z]{0,8}\d{3,6}\b/.test(l)) return true;
  return false;
}

export function sanitizeBookingReply(reply: string): string {
  if (!reply) return reply;
  const kept = reply
    .split(/\r?\n/)
    .filter((line) => !isFabricatedCodeLine(line));
  return (
    kept
      .join('\n')
      // Nuke any inline "voice consult code: 1234" that survived on a mixed line.
      .replace(
        /(voice\s*consult\s*code|kiosk\s*code|consult\s*code)\s*[:#\-]?\s*\d{3,6}/gi,
        '',
      )
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
