import { Contact } from '../models/CRM';
import { Channel } from '../types/agent';

/**
 * Multi-language STOP / UNSUBSCRIBE keyword detection.
 *
 * Patterns are normalised against an upper-cased, whitespace-trimmed
 * version of the message. The English-only set covers GDPR / CAN-SPAM
 * canonical keywords; the Sinhala set covers the most common natural
 * phrasings ("ayee epaa", "yawanna epa", "stop karanna").
 *
 * Detection is intentionally strict: the keyword must be the *whole*
 * message (modulo punctuation) so a customer asking "how do I stop
 * the recurring payment?" doesn't accidentally opt themselves out of
 * marketing entirely. The agreed industry boundary is single-word /
 * single-phrase replies.
 *
 * IMPORTANT: this is a CONVERSATIONAL enrollment/education bot, not a
 * one-way SMS marketing list. Bare negative answers like "No" (English) or
 * "Epa"/"එපා" (Sinhala "no / don't want") are ordinary replies to bot
 * questions — treating them as STOP keywords permanently suppressed real
 * leads from ALL campaigns and follow-ups. Those ambiguous single negatives
 * are deliberately NOT in this set; opting out requires an unambiguous
 * unsubscribe word/phrase (STOP, UNSUBSCRIBE, "stop karanna", "navathanna",
 * …). Multi-word Sinhala stop phrases ("aye epa" = "no more / stop") stay
 * because, as whole messages, they express intent to stop rather than a
 * bare answer.
 */
const STOP_KEYWORDS = new Set([
  // English / canonical
  'STOP',
  'UNSUBSCRIBE',
  'UNSUB',
  'OPT OUT',
  'OPTOUT',
  'OPT-OUT',
  'CANCEL',
  'QUIT',
  'REMOVE ME',
  // Sinhala (English-letter natural phrasing — most users type Sinhala phonetic)
  'AYE EPA',
  'AYEE EPA',
  'AYI EPA',
  'AYEE EPAA',
  'AAYE EPAA',
  'STOP KARANNA',
  'NAVATHANNA',
  'NAVATHA',
  // Tamil phonetic
  'NIRUTHU',
  'VENDAM',
]);

export function isStopKeyword(message: string | undefined | null): boolean {
  if (!message) return false;
  // Strip punctuation other than spaces; normalise whitespace; upper.
  const normalised = message
    .replace(/[.,!?;:'"()\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (normalised.length === 0 || normalised.length > 40) return false;
  return STOP_KEYWORDS.has(normalised);
}

/**
 * Mark every Contact matching the phone identifiers as opted out. Idempotent:
 * a second call has no observable effect beyond updating optedOutAt.
 *
 * When `tenantId` is supplied the update is scoped to that tenant (with the
 * usual legacy-row tolerance for un-tenanted contacts) so a STOP from one
 * tenant's customer can't opt out a different tenant's contact that happens
 * to share the same phone number. Callers that don't yet have tenant context
 * (the legacy single-process WhatsApp flow) may omit it.
 */
export async function markContactOptedOut(
  phoneOrJid: string,
  channel: Channel | 'manual',
  reason?: string,
  tenantId?: unknown,
): Promise<number> {
  if (!phoneOrJid) return 0;
  const raw = String(phoneOrJid).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits && !raw.includes('@')) return 0;

  const orClauses: Record<string, unknown>[] = [];
  if (digits) {
    orClauses.push(
      { phone: digits },
      { whatsappNumber: digits },
      { whatsappId: digits },
      { phone: { $regex: `${digits}$` } },
      { whatsappNumber: { $regex: `${digits}$` } },
    );
  }
  // Also match LID-only contacts stored under the full JID string (e.g.
  // '...@lid'), whose digits never line up with a real phone number.
  if (raw.includes('@')) {
    orClauses.push({ whatsappId: raw }, { 'customFields.rawWhatsappJid': raw });
  }
  if (orClauses.length === 0) return 0;
  const phoneClause = { $or: orClauses };
  const filter: Record<string, unknown> = tenantId
    ? {
        $and: [
          phoneClause,
          {
            $or: [
              { tenantId },
              { tenantId: { $exists: false } },
              { tenantId: null },
            ],
          },
        ],
      }
    : phoneClause;

  const res = await (Contact as any).updateMany(
    filter,
    {
      $set: {
        optedOut: true,
        optedOutAt: new Date(),
        optedOutReason: reason ?? `${channel}_stop_keyword`,
        optedOutChannel: channel,
        whatsappOptIn: false,
      },
    },
  );
  return res?.modifiedCount ?? 0;
}

/**
 * Returns true if the contact identified by the given phone/JID is
 * opted-out. Used as a pre-flight check in campaign / follow-up senders
 * so we never deliver to a contact who explicitly asked to be left alone.
 */
export async function isPhoneOptedOut(
  phoneOrJid: string,
  tenantId?: unknown,
): Promise<boolean> {
  if (!phoneOrJid) return false;
  const digits = phoneOrJid.replace(/\D/g, '');
  if (!digits) return false;

  // Mirror the suffix-match clauses used by markContactOptedOut so a contact
  // flagged via the suffix path (e.g. stored '+940771234567' vs STOP digits
  // '0771234567') is actually detected here. Without the suffix clauses the
  // pre-flight check missed those rows and campaign / follow-up senders kept
  // delivering to an opted-out contact — a compliance failure. `digits` is
  // \D-stripped so it contains only 0-9 and is safe to embed in $regex.
  const phoneClause = {
    optedOut: true,
    $or: [
      { phone: digits },
      { whatsappNumber: digits },
      { whatsappId: digits },
      { phone: { $regex: `${digits}$` } },
      { whatsappNumber: { $regex: `${digits}$` } },
    ],
  };
  // Tenant-scope the read (legacy-tolerant) when a tenant is supplied, mirroring
  // markContactOptedOut's tenant clause. Without it, ONE tenant's opt-out for a
  // number suppressed EVERY tenant's sends to a separately-consented contact
  // sharing that phone. Omitting tenantId keeps the prior global behaviour for
  // legacy callers.
  const filter: Record<string, unknown> = tenantId
    ? {
        $and: [
          phoneClause,
          {
            $or: [
              { tenantId },
              { tenantId: { $exists: false } },
              { tenantId: null },
            ],
          },
        ],
      }
    : phoneClause;
  const hit = await (Contact as any).findOne(filter, { _id: 1 }).lean();
  return Boolean(hit);
}
