import LidPhoneMapping from '../models/LidPhoneMapping';
import { extractRealPhone, isLidJid } from '../utils/jid';

export type LidPhoneMappingSource =
  | 'message'
  | 'phone_number_share'
  | 'chat_metadata'
  | 'manual';

export function normaliseLidJid(value: string | null | undefined): string | null {
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
  const phone = extractRealPhone(value);
  if (!phone) return null;
  return { phone, phoneJid: `${phone}@s.whatsapp.net` };
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
