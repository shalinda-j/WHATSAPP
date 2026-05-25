import LidPhoneMapping from '../models/LidPhoneMapping';
import ChatMessage from '../models/ChatMessage';
import { extractRealPhone, isLidJid } from '../utils/jid';

export type LidPhoneMappingSource =
  | 'message'
  | 'phone_number_share'
  | 'chat_metadata'
  | 'manual';

export function normaliseLidJid(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const raw = String(value).trim().replace(/^\+/, '');
  if (!raw) return null;
  if (isLidJid(raw)) return raw;
  const local = raw.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';
  return local ? `${local}@lid` : null;
}

export function normalisePhoneJid(
  value: string | null | undefined,
): { phone: string; phoneJid: string } | null {
  const phone = normalisePhoneDigits(value);
  if (!phone) return null;
  return { phone, phoneJid: `${phone}@s.whatsapp.net` };
}

export function normalisePhoneDigits(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (isLidJid(String(value).trim().replace(/^\+/, ''))) return null;
  const fromJid = extractRealPhone(value);
  if (fromJid) return fromJid;

  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;

  // Sri Lanka local mobile format: 0703179882 -> 94703179882.
  // The app's default market is Sri Lanka, and this keeps manual/in-message
  // repair ergonomic without treating opaque @lid ids as phones.
  if (/^0\d{9}$/.test(digits)) return `94${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `94${digits}`;
  return digits;
}

export function extractPhoneFromText(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const candidates = String(text).match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
  for (const candidate of candidates) {
    const phone = normalisePhoneDigits(candidate);
    if (phone) return phone;
  }
  return null;
}

export async function rememberLidPhoneMapping(params: {
  sessionId?: string;
  lidJid?: string | null;
  phoneJid?: string | null;
  source: LidPhoneMappingSource;
}): Promise<boolean> {
  const lidJid = normaliseLidJid(params.lidJid);
  const phone = normalisePhoneJid(params.phoneJid);
  if (!lidJid || !phone) return false;

  const now = new Date();
  const filter: Record<string, unknown> = { lidJid };
  if (params.sessionId) filter.sessionId = params.sessionId;
  await LidPhoneMapping.updateOne(
    filter,
    {
      $set: {
        sessionId: params.sessionId,
        lidJid,
        phoneJid: phone.phoneJid,
        phone: phone.phone,
        source: params.source,
        lastSeenAt: now,
      },
      $setOnInsert: { firstSeenAt: now },
    },
    { upsert: true },
  );
  return true;
}

export async function loadPhoneMapForLids(
  lidCandidates: string[],
  sessionId?: string,
): Promise<Map<string, string>> {
  const lids = Array.from(
    new Set(
      lidCandidates
        .map((candidate) => normaliseLidJid(candidate))
        .filter((lid): lid is string => Boolean(lid)),
    ),
  );
  const map = new Map<string, string>();
  if (lids.length === 0) return map;

  const scope: Record<string, unknown> = { lidJid: { $in: lids } };
  if (sessionId && sessionId !== 'all') {
    scope.$or = [{ sessionId }, { sessionId: { $exists: false } }];
  }

  const rows = await LidPhoneMapping.find(scope)
    .sort({ lastSeenAt: -1 })
    .lean();
  for (const row of rows) {
    if (!row.lidJid || !row.phone) continue;
    map.set(row.lidJid, row.phone);
    map.set(row.lidJid.replace('@lid', ''), row.phone);
  }
  return map;
}

/**
 * One-shot back-stamp of `metadata.realPhone` on every legacy ChatMessage
 * whose userId is an @lid AND for which we have a known phone in
 * LidPhoneMapping. Runs at boot from index.ts.
 *
 * Why this exists: the new resolvers (Baileys senderPn, contact-card
 * vCard parse, sock.onWhatsApp reverse lookup) only fire on NEW inbound
 * messages. Conversations stored before the resolvers shipped never got
 * realPhone, so the chat list shows "Unknown contact" even though the
 * `LidPhoneMapping` table — populated by contacts.upsert and
 * messaging-history.set — already knows who they are.
 *
 * Idempotent and cheap on subsequent boots:
 *   - Only updates ChatMessage rows where metadata.realPhone is MISSING;
 *     once stamped they're skipped forever.
 *   - One updateMany per distinct lidJid (typically thousands at most).
 *   - Errors swallowed per-row so a single bad mapping can't block the
 *     boot sequence.
 *
 * Returns the number of messages stamped, for log/operator visibility.
 */
export async function backfillRealPhoneOnExistingMessages(): Promise<number> {
  try {
    // Distinct LIDs in the mapping table. Aggregation collapses
    // multi-session duplicates so we don't re-stamp the same userId N
    // times — the final stamp would be the same anyway.
    const distinct = (await LidPhoneMapping.aggregate([
      {
        $group: {
          _id: '$lidJid',
          phone: { $first: '$phone' },
          lastSeenAt: { $max: '$lastSeenAt' },
        },
      },
      { $match: { _id: { $ne: null }, phone: { $ne: null } } },
    ])) as Array<{ _id: string; phone: string }>;

    if (distinct.length === 0) return 0;

    let totalStamped = 0;
    for (const row of distinct) {
      if (!row._id || !row.phone) continue;
      try {
        const result = await ChatMessage.updateMany(
          {
            userId: row._id,
            $or: [
              { 'metadata.realPhone': { $exists: false } },
              { 'metadata.realPhone': '' },
              { 'metadata.realPhone': null },
            ],
          },
          { $set: { 'metadata.realPhone': row.phone } },
        );
        totalStamped += result.modifiedCount ?? 0;
      } catch (err) {
        // Per-row failure must not halt the batch — surface in logs only.
        console.error(
          `LID backfill: failed to stamp ${row._id} → ${row.phone}:`,
          err,
        );
      }
    }

    if (totalStamped > 0) {
      console.log(
        `📞 LID backfill: stamped realPhone on ${totalStamped} legacy ChatMessage row(s) across ${distinct.length} mapping(s).`,
      );
    }
    return totalStamped;
  } catch (err) {
    console.error('LID backfill aggregation failed:', err);
    return 0;
  }
}
