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
  // A fabricated code line needs an actual 3–6 digit code AND code-issuing
  // context. Without the digit guard we deleted legit prose: an offer line
  // "free voice consultation" (no code) and address lines "postal code 10100" /
  // "area code 011" were stripped whole. Only strip when BOTH are present.
  const hasNum = /\d{3,6}/.test(l);
  if (line.includes('🔢')) return true;
  // "voice consultation" (a legit service offer) must survive → strip only when
  // an actual code number rides along, e.g. "Voice Consult Code: 1234".
  if (hasNum && /voice[\s-]*consult/.test(l)) return true;
  if (hasNum && /consult\s*code/.test(l)) return true;
  // The kiosk-code instruction line that accompanies a fabricated code — it may
  // itself carry no digit ("type this code at the kiosk"), so no hasNum guard.
  if (l.includes('kiosk') && l.includes('code')) return true;
  // "code: 1234", "your code is 4024" etc. — a bare fabricated code. EXCLUDE
  // address/reference-code prose (postal/area/zip/country/dialing/PIN/NIC code)
  // which legitimately reads "postal code 10100" / "area code 011".
  if (
    /\bcode\b[^0-9a-z]{0,8}\d{3,6}\b/.test(l) &&
    !/(postal|zip|area|country|dial|region|pin|nic)\s*code/.test(l)
  ) {
    return true;
  }
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
