import mongoose from 'mongoose';
import { extractRealPhone } from '../utils/jid';

/**
 * Conversation Enrichment Service
 *
 * Fire-and-forget enrichment that runs AFTER auto-registration on every
 * inbound message. It NEVER creates a Contact (AutoRegistrationService owns
 * creation) — it only UPDATES an already-existing Contact when the customer
 * volunteers useful structured information in plain chat:
 *
 *   1. A phone number they typed (e.g. "call me on 0771234567") — stored only
 *      when the Contact has no phone yet, so a real dialable number can fill an
 *      LID-only record without ever overwriting a known number.
 *   2. A follow-up date they mentioned (e.g. "call me tomorrow", "next monday",
 *      "in 3 days", "12/07") — sets nextFollowUp + flips status to follow_up.
 *
 * Both extractors are deterministic (NO LLM). Everything is wrapped so this can
 * never throw and never blocks message handling. It is idempotent: it only
 * issues a DB write when a real change is detected.
 */

// Lazy model lookup to avoid circular import / model-not-registered ordering.
const getContactModel = (): any => {
  try {
    return mongoose.model('Contact');
  } catch {
    return null;
  }
};

/**
 * Extract a single plausible phone number the user TYPED in chat.
 *
 * Accepts 9–15 digits after stripping spaces / dashes / parentheses. Sri Lanka
 * local numbers (0XXXXXXXXX) are normalised to the 94XXXXXXXXX international
 * form; numbers written with a leading "+" keep their country code as typed.
 * Years / prices / short codes are ignored by requiring at least 9 digits.
 *
 * Returns the normalised digits (no "+"), or null when nothing qualifies.
 */
export function extractPhoneFromText(text: string): string | null {
  if (!text || typeof text !== 'string') return null;

  // Candidate tokens: an optional "+", then a run of digits with spaces,
  // dashes, dots or parentheses between them (at least ~9 chars long).
  const candidates = text.match(/\+?\d[\d\s().\-]{7,}\d/g);
  if (!candidates) return null;

  for (const raw of candidates) {
    const hasPlus = raw.trim().startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;

    let normalized = digits;
    // Sri Lanka local form: 0XXXXXXXXX -> 94XXXXXXXXX. Only when the user did
    // NOT type an explicit international "+" prefix.
    if (
      !hasPlus &&
      digits.startsWith('0') &&
      digits.length >= 9 &&
      digits.length <= 11
    ) {
      normalized = `94${digits.slice(1)}`;
    }

    if (normalized.length < 9 || normalized.length > 15) continue;
    return normalized;
  }

  return null;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Build a Date `addDays` after `base`, pinned to 09:00 local time. */
function atNineAm(base: Date, addDays: number): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + addDays,
    9,
    0,
    0,
    0,
  );
}

/**
 * Conservatively detect a FUTURE date the user mentioned in chat.
 *
 * Supported forms (case-insensitive):
 *   - today / tomorrow
 *   - weekday names (monday..sunday, optionally prefixed with "next") -> next
 *     occurrence of that weekday
 *   - next week (+7 days)
 *   - in N days / in N weeks
 *   - explicit dates DD/MM, DD/MM/YYYY, D-M (day-first, Sri Lankan convention)
 *
 * The resulting time is always 09:00 local on the matched day. Ambiguous input
 * returns null, and a computed date that is not strictly in the future returns
 * null. `now` defaults to a fresh Date().
 */
export function parseFollowUpDate(
  text: string,
  now: Date = new Date(),
): Date | null {
  if (!text || typeof text !== 'string') return null;

  const t = text.toLowerCase();

  const futureOrNull = (d: Date | null): Date | null => {
    if (!d) return null;
    return d.getTime() > now.getTime() ? d : null;
  };

  // 1. Explicit date: DD/MM, DD/MM/YYYY, D-M (day-first).
  const dateMatch = t.match(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    const rawYear = dateMatch[3] ? parseInt(dateMatch[3], 10) : undefined;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const year =
        rawYear === undefined
          ? now.getFullYear()
          : rawYear < 100
            ? 2000 + rawYear
            : rawYear;
      let d = new Date(year, month - 1, day, 9, 0, 0, 0);
      // Reject impossible dates (e.g. 31/02 rolled over by JS).
      const valid = d.getMonth() === month - 1 && d.getDate() === day;
      if (valid) {
        // No explicit year and already in the past -> assume next year.
        if (rawYear === undefined && d.getTime() <= now.getTime()) {
          d = new Date(year + 1, month - 1, day, 9, 0, 0, 0);
        }
        return futureOrNull(d);
      }
    }
  }

  // 2. in N weeks
  const inWeeks = t.match(/\bin\s+(\d{1,3})\s+weeks?\b/);
  if (inWeeks) {
    const n = parseInt(inWeeks[1], 10);
    if (n >= 1 && n <= 104) return futureOrNull(atNineAm(now, n * 7));
  }

  // 3. in N days
  const inDays = t.match(/\bin\s+(\d{1,3})\s+days?\b/);
  if (inDays) {
    const n = parseInt(inDays[1], 10);
    if (n >= 1 && n <= 365) return futureOrNull(atNineAm(now, n));
  }

  // 4. next week
  if (/\bnext\s+week\b/.test(t)) {
    return futureOrNull(atNineAm(now, 7));
  }

  // 5. weekday names (optionally prefixed with "next") -> next occurrence
  const weekdayMatch = t.match(
    /\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (weekdayMatch) {
    const target = WEEKDAYS[weekdayMatch[1]];
    const current = now.getDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7; // never "today" — push to next occurrence
    return futureOrNull(atNineAm(now, delta));
  }

  // 6. tomorrow
  if (/\btomorrow\b/.test(t)) {
    return futureOrNull(atNineAm(now, 1));
  }

  // 7. today (only if 09:00 today is still in the future)
  if (/\btoday\b/.test(t)) {
    return futureOrNull(atNineAm(now, 0));
  }

  return null;
}

interface EnrichInput {
  /** WhatsApp JID of the sender. */
  userId: string;
  /** The inbound message text. */
  text: string;
  sessionId?: string;
  /** Boot-resolved default tenant id, may be undefined. */
  tenantId?: string;
  /** Already-resolved real phone, if any. */
  realPhone?: string;
}

const ENRICHABLE_STATUSES = new Set([
  'new',
  'active',
  'contacted',
  'interested',
]);

/**
 * Enrich an EXISTING Contact from a single inbound message. Fire-and-forget;
 * never throws, never creates a Contact, and only writes when something
 * actually changed.
 */
export async function enrichContactFromMessage(
  input: EnrichInput,
): Promise<void> {
  try {
    if (!input || !input.userId) return;

    // Skip silently when the DB is not connected — the next message retries.
    if (mongoose.connection.readyState !== 1) return;

    const text = typeof input.text === 'string' ? input.text : '';
    if (!text.trim()) return;

    const typedPhone = extractPhoneFromText(text);
    const followUpDate = parseFollowUpDate(text);

    // Nothing to extract -> no work.
    if (!typedPhone && !followUpDate) return;

    const Contact = getContactModel();
    if (!Contact) return;

    const { userId, realPhone, tenantId } = input;
    const phone = realPhone ?? extractRealPhone(userId) ?? undefined;
    const rawIdentifier = userId.replace(/^\+/, '');

    // Same identity OR-query AutoRegistrationService uses.
    const identityClauses: Record<string, unknown>[] = [
      { whatsappNumber: userId },
      { whatsappId: userId },
      { 'customFields.rawWhatsappJid': rawIdentifier },
    ];
    if (phone) {
      identityClauses.push(
        { phone: `+${phone}` },
        { phone },
        { whatsappNumber: phone },
        { whatsappId: phone },
      );
    }

    // Soft tenant scoping (tenantId or legacy missing/null), matching the CRM
    // list endpoints. Only applied when a tenant id was resolved.
    let query: Record<string, unknown>;
    if (tenantId) {
      query = {
        $and: [
          { $or: identityClauses },
          {
            $or: [
              { tenantId },
              { tenantId: null },
              { tenantId: { $exists: false } },
            ],
          },
        ],
      };
    } else {
      query = { $or: identityClauses };
    }

    const existing = await Contact.findOne(query);
    if (!existing) return; // AutoRegistrationService owns creation.

    const set: Record<string, unknown> = {};

    // (a) Fill phone only when the Contact has none yet.
    if (typedPhone && !existing.phone) {
      set.phone = `+${typedPhone}`;
      set.whatsappNumber = typedPhone;
    }

    // (b) Schedule a follow-up, but never downgrade a converted/closed status.
    if (followUpDate) {
      const currentStatus = String(existing.status || 'new');
      if (ENRICHABLE_STATUSES.has(currentStatus)) {
        set.nextFollowUp = followUpDate;
        set.status = 'follow_up';
        const iso = followUpDate.toISOString();
        const note = `Requested follow-up via chat: ${iso}`;
        const prevNotes =
          typeof existing.notes === 'string' ? existing.notes : '';
        set.notes = prevNotes ? `${prevNotes}\n${note}` : note;
      }
    }

    // Skip the write entirely if nothing changed.
    if (Object.keys(set).length === 0) return;

    set.updatedAt = new Date();
    await Contact.updateOne({ _id: existing._id }, { $set: set });
  } catch (err: any) {
    console.warn('⚠️ Conversation enrichment skipped:', err?.message || err);
  }
}

export default {
  enrichContactFromMessage,
  extractPhoneFromText,
  parseFollowUpDate,
};
