/**
 * WhatsApp JID helpers — these centralise the "what does this identifier
 * actually mean" question so the chat list, exports and CRM lookup all
 * agree on the same answer.
 *
 * Background — JID shapes in the wild:
 *   '94771234567@s.whatsapp.net'   — classic phone-backed JID (E.164 digits)
 *   '94771234567:50@s.whatsapp.net' — multi-device variant (device suffix)
 *   '15889278493xxxx@lid'           — Linked-ID, opaque 14–17 digit identifier
 *                                     introduced for privacy. NOT a phone.
 *   '120363xxxxxxxxxx@g.us'         — group JID
 *   '8001234567@c.us'               — legacy 'chat' suffix
 *
 * The LID rollout means stripping the suffix and prepending '+' (the old
 * shortcut) prints garbage like '+158892784939233' in the UI. Code that
 * presents a phone to the operator must consult `extractRealPhone()` first
 * and treat `null` as "we don't know the real number — show pushName /
 * placeholder instead, never a fake +<lid> number".
 */

/** True when the JID is a Linked-ID (privacy identifier, not a phone). */
export function isLidJid(jid: string | undefined | null): boolean {
  if (!jid) return false;
  return jid.endsWith('@lid');
}

/** True when the JID is a WhatsApp group. */
export function isGroupJid(jid: string | undefined | null): boolean {
  if (!jid) return false;
  return jid.endsWith('@g.us');
}

/**
 * Best-effort extraction of the real phone-number JID from a raw Baileys
 * message. Modern Baileys (6.6+) attaches `senderPn` / `participantPn`
 * fields to the message key for `@lid` messages — these carry the
 * actual phone number behind the LID. Fields are untyped in 6.6.x so
 * we read them defensively.
 *
 * Returns null when no phone-shaped identifier is available.
 */
export function extractPhoneJidFromMessage(rawMessage: unknown): string | null {
  if (!rawMessage || typeof rawMessage !== 'object') return null;
  const msg = rawMessage as { key?: Record<string, unknown> };
  const key = msg.key ?? {};

  // Try, in order, the fields Baileys may surface a real-PN through.
  const candidates: unknown[] = [
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    key.senderAlt,
    // Some builds nest it under `previousId` / `userJid`.
    (msg as any).userJid,
  ];
  for (const c of candidates) {
    if (typeof c !== 'string' || c.length === 0) continue;
    if (isLidJid(c) || isGroupJid(c)) continue;
    const phone = extractRealPhone(c);
    if (phone) {
      return c.includes('@') ? c : `${phone}@s.whatsapp.net`;
    }
  }
  return null;
}

/**
 * Extracts the **real** E.164-style phone digits from a JID, or null when the
 * JID can't safely be mapped to a phone (LIDs, groups, malformed inputs).
 *
 * Heuristics:
 *   - Reject `@lid` and `@g.us` JIDs outright.
 *   - Strip a `:<device>` suffix on the local part (multi-device JIDs).
 *   - Require 8–15 digits after stripping (E.164 max is 15, country codes
 *     start at 1 digit, no real number is shorter than 8). This rejects
 *     the long opaque values that LIDs sometimes leak into the address
 *     book via legacy import paths.
 */
export function extractRealPhone(
  jid: string | undefined | null,
): string | null {
  if (!jid) return null;
  if (isLidJid(jid) || isGroupJid(jid)) return null;
  const local = jid.split('@')[0]?.split(':')[0] ?? '';
  const digits = local.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * Last-resort label for a JID we couldn't resolve to a contact. Returns
 * a short stable string the operator can recognise across re-renders —
 * never a fake `+<lid>` number.
 *   `+94771234567`                     for phone-backed JIDs
 *   `LID …4567`                        for LIDs (last 4 of the opaque id)
 *   `Group …a1b2`                      for groups
 *   `Unknown`                          for everything else
 */
export function fallbackJidLabel(jid: string | undefined | null): string {
  if (!jid) return 'Unknown';
  if (isLidJid(jid)) {
    const tail = jid.replace('@lid', '').slice(-4);
    return `LID …${tail}`;
  }
  if (isGroupJid(jid)) {
    const tail = jid.replace('@g.us', '').slice(-4);
    return `Group …${tail}`;
  }
  const phone = extractRealPhone(jid);
  if (phone) return `+${phone}`;
  return 'Unknown';
}
