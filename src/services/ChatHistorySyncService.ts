import type { proto } from '@whiskeysockets/baileys';
import ChatMessage from '../models/ChatMessage';
import { getDefaultTenantId } from './TenantBootstrapService';
import { extractPhoneJidFromMessage, extractRealPhone } from '../utils/jid';

/**
 * WhatsApp history sync — persists the chat history WhatsApp hands over on
 * pairing so the admin Live Chat shows conversations that happened BEFORE
 * the bot was ever connected.
 *
 * Why this is a separate ingest path:
 *   `messages.upsert` (type 'notify') is the live path — it runs the AI
 *   handler chain and replies to the customer. Historical messages must
 *   NEVER touch that chain: replying to a two-year-old "hi" would spam
 *   every past customer the moment a device is paired. So history arrives
 *   via `messaging-history.set` and lands here, which only writes rows.
 *
 * What gets stored:
 *   One ChatMessage per historical message, marked `read: true` (history
 *   must not light up the unread badges) and stamped with `waMessageId`
 *   so a re-delivered batch upserts instead of duplicating.
 *
 * Enabling:
 *   `syncFullHistory` on the socket (see whatsapp.ts) controls whether
 *   WhatsApp sends the full history at all. WhatsApp only ships history to
 *   a NEWLY LINKED device — turning the flag on does not retroactively pull
 *   history into an already-paired session; that session has to be
 *   unlinked and re-scanned.
 */

/** Per-run cap so a huge account can't write unbounded rows in one sync. */
export const HISTORY_SYNC_MAX_MESSAGES = (() => {
  const raw = Number(process.env.WHATSAPP_HISTORY_MAX_MESSAGES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50_000;
})();

/** Mongo bulkWrite batch size — keeps each round-trip predictable. */
const BATCH_SIZE = 500;

/**
 * Whether WhatsApp should ship history at all. Read at socket-creation time
 * so an operator can flip it in `.env` and restart without a code change.
 * Defaults ON — the whole point of this module.
 */
export function isHistorySyncEnabled(): boolean {
  const raw = (process.env.WHATSAPP_SYNC_FULL_HISTORY ?? '')
    .trim()
    .toLowerCase();
  if (raw === '') return true;
  return raw !== 'false' && raw !== '0' && raw !== 'no' && raw !== 'off';
}

export type HistoryMessageDoc = {
  userId: string;
  role: 'user' | 'assistant';
  type: 'text' | 'voice' | 'image' | 'video' | 'document' | 'sticker';
  content: string;
  timestamp: Date;
  read: true;
  waMessageId: string;
  tenantId?: string;
  metadata: {
    sessionId: string;
    pushName?: string;
    realPhone?: string;
    /** Marks the row as back-filled rather than seen live. */
    source: 'history_sync';
  };
};

/**
 * Unwrap the ephemeral / view-once envelopes WhatsApp nests real payloads
 * inside. Mirrors getMessageText() in whatsapp.ts — duplicated rather than
 * imported to keep this module free of a circular dependency on the socket
 * manager (whatsapp.ts imports this file).
 */
function unwrap(
  raw: proto.IWebMessageInfo['message'],
): NonNullable<proto.IWebMessageInfo['message']> | null {
  if (!raw) return null;
  return (
    raw.ephemeralMessage?.message ??
    raw.viewOnceMessage?.message ??
    raw.viewOnceMessageV2?.message ??
    raw.viewOnceMessageV2Extension?.message ??
    raw
  );
}

/**
 * Derive the stored `type` + `content` for a historical message.
 *
 * `content` is required by the schema, so captionless media gets a readable
 * placeholder (`[image]`, `[voice message]`, …) instead of being dropped —
 * an operator scrolling old history needs to see that *something* was sent,
 * not a gap. Returns null for messages with no user-visible body at all
 * (protocol updates, reactions, poll votes, key distribution), which must
 * not become chat rows.
 */
export function describeHistoryMessage(
  message: proto.IWebMessageInfo['message'],
): { type: HistoryMessageDoc['type']; content: string } | null {
  const msg = unwrap(message);
  if (!msg) return null;

  const text =
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    '';

  if (msg.audioMessage) {
    return {
      type: 'voice',
      content: text || (msg.audioMessage.ptt ? '[voice message]' : '[audio]'),
    };
  }
  if (msg.imageMessage) return { type: 'image', content: text || '[image]' };
  if (msg.videoMessage) return { type: 'video', content: text || '[video]' };
  if (msg.stickerMessage) return { type: 'sticker', content: '[sticker]' };
  if (msg.documentMessage || msg.documentWithCaptionMessage) {
    const fileName =
      msg.documentMessage?.fileName ||
      msg.documentWithCaptionMessage?.message?.documentMessage?.fileName ||
      '';
    return {
      type: 'document',
      content: text || (fileName ? `[document: ${fileName}]` : '[document]'),
    };
  }
  if (msg.locationMessage || msg.liveLocationMessage) {
    return { type: 'text', content: '[location]' };
  }
  if (msg.contactMessage || msg.contactsArrayMessage) {
    return { type: 'text', content: '[contact card]' };
  }
  if (text.trim() !== '') return { type: 'text', content: text };

  // protocolMessage, reactionMessage, pollUpdateMessage,
  // senderKeyDistributionMessage, and friends — nothing to show.
  return null;
}

/** Seconds-since-epoch (number | Long | string) → Date, or null if unusable. */
export function historyTimestampToDate(raw: unknown): Date | null {
  if (raw == null) return null;
  let seconds: number;
  if (typeof raw === 'number') seconds = raw;
  else if (typeof raw === 'string') seconds = Number(raw);
  else if (typeof raw === 'object' && 'toNumber' in (raw as object)) {
    // Baileys hands back a Long for large timestamps.
    seconds = (raw as { toNumber: () => number }).toNumber();
  } else seconds = Number(raw);

  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Chats we never want as conversation rows. */
export function isSkippableHistoryJid(jid: string | null | undefined): boolean {
  if (!jid) return true;
  return (
    jid === 'status@broadcast' ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@newsletter')
  );
}

/**
 * Map one historical WhatsApp message onto a ChatMessage document.
 * Pure — no DB, no clock — so the skip rules are unit-testable.
 * Returns null when the message must not become a chat row.
 */
export function mapHistoryMessage(
  message: proto.IWebMessageInfo,
  sessionId: string,
  tenantId?: string | null,
): HistoryMessageDoc | null {
  const jid = message?.key?.remoteJid;
  if (isSkippableHistoryJid(jid)) return null;

  const waMessageId = message?.key?.id;
  if (!waMessageId) return null;

  const timestamp = historyTimestampToDate(message.messageTimestamp);
  if (!timestamp) return null;

  const described = describeHistoryMessage(message.message);
  if (!described) return null;

  const realPhone =
    extractRealPhone(extractPhoneJidFromMessage(message)) ??
    extractRealPhone(jid) ??
    undefined;

  return {
    userId: jid as string,
    // Outbound history is the operator's/bot's own side of the chat.
    role: message.key?.fromMe ? 'assistant' : 'user',
    type: described.type,
    content: described.content,
    timestamp,
    // History must never inflate the unread badges — it is, by definition,
    // already-seen traffic.
    read: true,
    waMessageId,
    ...(tenantId ? { tenantId } : {}),
    metadata: {
      sessionId,
      ...(message.pushName ? { pushName: message.pushName } : {}),
      ...(realPhone ? { realPhone } : {}),
      source: 'history_sync' as const,
    },
  };
}

/**
 * Drop history messages that a live ingest already stored.
 *
 * Rows written before this module existed carry no `waMessageId`, so the
 * upsert key can't see them and the same message would land twice —
 * doubling message counts and duplicating the chat list's last message.
 * One bounded lookup per batch over (userId, timestamp-window) builds a
 * `userId|role|epochSeconds` key set to filter against.
 */
async function dropAlreadyStored(
  docs: HistoryMessageDoc[],
): Promise<HistoryMessageDoc[]> {
  if (docs.length === 0) return docs;

  const userIds = Array.from(new Set(docs.map((d) => d.userId)));
  const times = docs.map((d) => d.timestamp.getTime());
  const existing = (await ChatMessage.find(
    {
      userId: { $in: userIds },
      timestamp: {
        $gte: new Date(Math.min(...times)),
        $lte: new Date(Math.max(...times)),
      },
      waMessageId: { $exists: false },
    },
    { userId: 1, role: 1, timestamp: 1 },
  ).lean()) as Array<{ userId: string; role: string; timestamp: Date }>;

  if (existing.length === 0) return docs;

  const key = (userId: string, role: string, ts: Date) =>
    `${userId}|${role}|${Math.floor(ts.getTime() / 1000)}`;
  const seen = new Set(
    existing.map((row) => key(row.userId, row.role, new Date(row.timestamp))),
  );
  return docs.filter((d) => !seen.has(key(d.userId, d.role, d.timestamp)));
}

export type HistorySyncResult = {
  /** Messages the mapper accepted. */
  mapped: number;
  /** Rows actually created (upserts that inserted). */
  inserted: number;
  /** Mapped rows already present — re-delivered or live-ingested. */
  duplicates: number;
  /** Messages rejected by the mapper (protocol noise, broadcasts, …). */
  skipped: number;
};

/**
 * Persist a `messaging-history.set` batch. Idempotent: re-running the same
 * batch inserts nothing the second time.
 */
export async function persistHistoryMessages(
  sessionId: string,
  messages: proto.IWebMessageInfo[],
): Promise<HistorySyncResult> {
  const result: HistorySyncResult = {
    mapped: 0,
    inserted: 0,
    duplicates: 0,
    skipped: 0,
  };
  if (!Array.isArray(messages) || messages.length === 0) return result;

  const tenantId = getDefaultTenantId();
  const capped = messages.slice(0, HISTORY_SYNC_MAX_MESSAGES);
  if (capped.length < messages.length) {
    console.warn(
      `⚠️ History sync [${sessionId}]: batch of ${messages.length} truncated to ` +
        `${capped.length} (WHATSAPP_HISTORY_MAX_MESSAGES)`,
    );
  }

  const docs: HistoryMessageDoc[] = [];
  for (const message of capped) {
    const doc = mapHistoryMessage(message, sessionId, tenantId);
    if (doc) docs.push(doc);
    else result.skipped += 1;
  }
  result.mapped = docs.length;
  if (docs.length === 0) return result;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const fresh = await dropAlreadyStored(batch);
    result.duplicates += batch.length - fresh.length;
    if (fresh.length === 0) continue;

    // Upsert keyed on the WhatsApp message id alone — a top-level field, so
    // `$setOnInsert` can set the whole `metadata` subdocument without Mongo
    // reporting a conflicting update path.
    const ops = fresh.map((doc) => ({
      updateOne: {
        filter: { waMessageId: doc.waMessageId },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    }));

    try {
      const res = await ChatMessage.bulkWrite(ops, { ordered: false });
      const upserted = res?.upsertedCount ?? 0;
      result.inserted += upserted;
      result.duplicates += fresh.length - upserted;
    } catch (err) {
      // ordered:false means a partial failure still wrote the rest; log and
      // keep going so one bad row can't abort an entire history sync.
      console.error(`❌ History sync [${sessionId}] batch write failed:`, err);
    }
  }

  return result;
}

/**
 * Serialise per-session history handling. WhatsApp fires
 * `messaging-history.set` repeatedly during a sync, and concurrent batches
 * for the same session would race the dedupe lookup above.
 */
const syncQueues = new Map<string, Promise<unknown>>();

export function queueHistorySync(
  sessionId: string,
  messages: proto.IWebMessageInfo[],
  isLatest?: boolean,
): Promise<HistorySyncResult | null> {
  const previous = syncQueues.get(sessionId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const result = await persistHistoryMessages(sessionId, messages);
      if (result.mapped > 0 || result.skipped > 0) {
        console.log(
          `📚 History sync [${sessionId}]: +${result.inserted} stored, ` +
            `${result.duplicates} already known, ${result.skipped} skipped` +
            (isLatest ? ' (final batch)' : ''),
        );
      }
      return result;
    })
    .catch((err) => {
      console.error(`❌ History sync [${sessionId}] failed:`, err);
      return null;
    });

  syncQueues.set(sessionId, next);
  return next;
}

/** Test/shutdown helper — drops the per-session queue references. */
export function resetHistorySyncQueues(): void {
  syncQueues.clear();
}
