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
  'END',
  'NO',
  'REMOVE ME',
  // Sinhala (English-letter natural phrasing — most users type Sinhala phonetic)
  'AYE EPA',
  'AYEE EPA',
  'AYI EPA',
  'AYEE EPAA',
  'AAYE EPAA',
  'EPA',
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
 */
export async function markContactOptedOut(
  phoneOrJid: string,
  channel: Channel | 'manual',
  reason?: string,
): Promise<number> {
  if (!phoneOrJid) return 0;
  const digits = phoneOrJid.replace(/\D/g, '');
  if (!digits) return 0;

  const res = await (Contact as any).updateMany(
    {
      $or: [
        { phone: digits },
        { whatsappNumber: digits },
        { whatsappId: digits },
        { phone: { $regex: `${digits}$` } },
        { whatsappNumber: { $regex: `${digits}$` } },
      ],
    },
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
export async function isPhoneOptedOut(phoneOrJid: string): Promise<boolean> {
  if (!phoneOrJid) return false;
  const digits = phoneOrJid.replace(/\D/g, '');
  if (!digits) return false;

  const hit = await (Contact as any)
    .findOne(
      {
        optedOut: true,
        $or: [
          { phone: digits },
          { whatsappNumber: digits },
          { whatsappId: digits },
        ],
      },
      { _id: 1 },
    )
    .lean();
  return Boolean(hit);
}
