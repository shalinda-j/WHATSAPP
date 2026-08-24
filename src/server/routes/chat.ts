import { Router, Request, Response } from 'express';
import multer from 'multer';
import ChatMessage from '../../models/ChatMessage';
import Session from '../../models/Session';
import { Contact } from '../../models/CRM';
import LidPhoneMapping from '../../models/LidPhoneMapping';
import {
  sendMessage,
  sendMediaMessage,
  sendVoiceMessage,
  resolveActiveSessionId,
} from '../../services/whatsapp';
import { storeChatMedia } from '../../services/ChatMediaStorageService';
import { getIO } from '../socket';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import {
  resolveTenant,
  withTenantScope,
  tenantIdOf,
} from '../middleware/tenantContext';
import { extractRealPhone, fallbackJidLabel, isLidJid } from '../../utils/jid';
import {
  normaliseLidJid,
  normalisePhoneJid,
} from '../../services/LidPhoneMappingService';

const router = Router();
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024, files: 1 },
});
const SAFE_CHAT_UPLOAD_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/ogg',
  'audio/opus',
  'audio/webm',
  'audio/mpeg',
  'audio/mp4',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

// SECURITY FIX: All chat routes require authentication + tenant context.
router.use(authenticateToken);
router.use(resolveTenant);

/**
 * Conversation-list paging.
 *
 * The list used to be hard-capped at 100 rows, so operators with more than
 * 100 chats simply could not reach the older conversations — the sidebar
 * stopped scrolling at 100 with no indication that anything was missing.
 * The endpoint is now pageable (`?limit=&skip=`) and reports the true
 * `total`, so the UI can keep loading until every stored conversation is
 * on screen.
 */
export const DEFAULT_CONVERSATION_LIMIT = 200;
export const MAX_CONVERSATION_LIMIT = 1000;

/**
 * Parse `limit` / `skip` (alias `offset`) off the query string.
 * - `limit=all` (or `0`) means "as many as one request may return".
 * - Anything unparsable falls back to the default; negatives clamp to 0.
 */
export function parseConversationPaging(query: {
  limit?: unknown;
  skip?: unknown;
  offset?: unknown;
}): { limit: number; skip: number } {
  const rawLimit = query.limit;
  let limit = DEFAULT_CONVERSATION_LIMIT;
  if (typeof rawLimit === 'string' || typeof rawLimit === 'number') {
    const asString = String(rawLimit).trim().toLowerCase();
    if (asString === 'all' || asString === 'max') {
      limit = MAX_CONVERSATION_LIMIT;
    } else if (asString !== '') {
      const parsed = Number(asString);
      if (Number.isFinite(parsed)) {
        limit = parsed <= 0 ? MAX_CONVERSATION_LIMIT : Math.floor(parsed);
      }
    }
  }
  limit = Math.min(Math.max(limit, 1), MAX_CONVERSATION_LIMIT);

  const rawSkip = query.skip ?? query.offset;
  let skip = 0;
  if (typeof rawSkip === 'string' || typeof rawSkip === 'number') {
    const parsed = Number(String(rawSkip).trim());
    if (Number.isFinite(parsed) && parsed > 0) skip = Math.floor(parsed);
  }

  return { limit, skip };
}

/**
 * GET /api/chat/conversations
 * Get list of unique conversations with last message and unread count.
 * Optional `?sessionId=X` scopes the result to a specific device when an
 * operator wants to see only one WhatsApp session's chats at a time.
 * Optional `?limit=&skip=` pages through the full list (see
 * parseConversationPaging). The response carries `total` / `hasMore` so the
 * client can keep fetching until nothing is left.
 */
router.get('/conversations', async (req: AuthRequest, res: Response) => {
  try {
    const sessionId =
      typeof req.query.sessionId === 'string' &&
      req.query.sessionId !== 'all' &&
      req.query.sessionId !== ''
        ? req.query.sessionId
        : null;

    const { limit, skip } = parseConversationPaging(
      req.query as Record<string, unknown>,
    );

    const baseMatch: Record<string, unknown> = {};
    if (sessionId) baseMatch['metadata.sessionId'] = sessionId;
    const scopedMatch = withTenantScope(req, baseMatch);
    const hasMatchStage =
      Boolean(sessionId) || Object.keys(scopedMatch).length > 0;

    // Aggregate to get unique users with their last message. $facet returns
    // the requested page AND the total conversation count in a single pass,
    // so paging never costs a second full scan.
    const faceted = (await ChatMessage.aggregate([
      ...(hasMatchStage ? [{ $match: scopedMatch }] : []),
      {
        $sort: { timestamp: -1 },
      },
      {
        $group: {
          _id: '$userId',
          lastMessage: { $first: '$$ROOT' },
          messageCount: { $sum: 1 },
        },
      },
      {
        $facet: {
          rows: [
            { $sort: { 'lastMessage.timestamp': -1 } },
            { $skip: skip },
            { $limit: limit },
          ],
          meta: [{ $count: 'total' }],
        },
      },
    ])) as Array<{
      rows: any[];
      meta: Array<{ total?: number }>;
    }>;

    const conversations = faceted[0]?.rows ?? [];
    const total = faceted[0]?.meta?.[0]?.total ?? conversations.length;
    const pageUserIds = conversations.map((c: any) => c._id);

    // Get unread counts (messages from user that haven't been read by admin).
    // Scoped to the userIds on this page — the full-collection version was
    // pure waste once the list became pageable.
    const unreadCounts =
      pageUserIds.length === 0
        ? []
        : await ChatMessage.aggregate([
            {
              $match: withTenantScope(req, {
                role: 'user',
                read: { $ne: true },
                userId: { $in: pageUserIds },
                ...(sessionId ? { 'metadata.sessionId': sessionId } : {}),
              }),
            },
            {
              $group: {
                _id: '$userId',
                unreadCount: { $sum: 1 },
              },
            },
          ]);

    // Create a map of unread counts
    const unreadMap = new Map(
      unreadCounts.map((item: any) => [item._id, item.unreadCount]),
    );

    // Bulk-resolve userInfo (name + real phone) for every userId in one
    // bounded Contact query — much cheaper than a per-row findOne. Phone
    // resolution priority:
    //   1. metadata.realPhone on the last message (carries the actual
    //      number for @lid users that Baileys exposed via senderPn)
    //   2. extractRealPhone() on the userId (works for @s.whatsapp.net)
    //   3. Lookup the LID against any earlier message that did carry a
    //      realPhone for the same userId — handles older messages that
    //      arrived before the realPhone resolver landed.
    // LIDs with no realPhone anywhere fall through to the pushName label
    // on the frontend.
    const phoneByUserId = new Map<string, string>();
    const unresolvedLidUserIds: string[] = [];
    for (const conv of conversations as Array<{
      _id: string;
      lastMessage: { metadata?: { realPhone?: string } };
    }>) {
      const fromLastMsg = conv.lastMessage?.metadata?.realPhone;
      if (fromLastMsg) {
        phoneByUserId.set(conv._id, fromLastMsg);
        continue;
      }
      const fromJid = extractRealPhone(conv._id);
      if (fromJid) {
        phoneByUserId.set(conv._id, fromJid);
        continue;
      }
      unresolvedLidUserIds.push(conv._id);
    }

    // Back-fill #1 — any earlier ChatMessage that carries a realPhone
    // for the same userId. One $group over the (userId, metadata.realPhone)
    // path.
    if (unresolvedLidUserIds.length > 0) {
      const backfill = (await ChatMessage.aggregate([
        {
          $match: withTenantScope(req, {
            userId: { $in: unresolvedLidUserIds },
            'metadata.realPhone': { $exists: true, $ne: '' },
          }),
        },
        {
          $group: {
            _id: '$userId',
            realPhone: { $first: '$metadata.realPhone' },
          },
        },
      ])) as Array<{ _id: string; realPhone: string }>;
      for (const row of backfill) {
        if (row.realPhone) phoneByUserId.set(row._id, row.realPhone);
      }
    }

    // Back-fill #2 — for LIDs STILL unresolved after the ChatMessage
    // back-fill, consult the LidPhoneMapping collection. That collection
    // is populated by Baileys hooks (contacts.upsert / contacts.update /
    // messaging-history.set / chats.phoneNumberShare) as well as by
    // text-extraction during inbound. It captures mappings that the
    // chat-history aggregation cannot see — e.g. a customer who shared
    // their phone via a contact card whose vCard the bot parsed, or a
    // mapping the operator entered manually via POST /api/chat/lid/map.
    //
    // Without this step the chat list would forever render "Verifying
    // number…" for those conversations even though we know who the
    // person is — the gap that surfaced the LID digits to the operator.
    const stillUnresolved = unresolvedLidUserIds.filter(
      (uid) => !phoneByUserId.has(uid),
    );
    if (stillUnresolved.length > 0) {
      const lidKeys = stillUnresolved
        .map((uid) => normaliseLidJid(uid) ?? (isLidJid(uid) ? uid : null))
        .filter((v): v is string => Boolean(v));
      if (lidKeys.length > 0) {
        const mappings = await LidPhoneMapping.find({
          lidJid: { $in: lidKeys },
          // Don't constrain by sessionId — a mapping learned on session A
          // is still valid for the same LID on session B (same person).
        })
          .sort({ lastSeenAt: -1 })
          .lean();
        // The find() may return multiple rows per lid (different sessions);
        // .sort lastSeenAt desc means the first row we see per lid is the
        // freshest.
        const byLid = new Map<string, string>();
        for (const row of mappings as Array<{
          lidJid: string;
          phone: string;
        }>) {
          if (!byLid.has(row.lidJid) && row.phone) {
            byLid.set(row.lidJid, row.phone);
          }
        }
        for (const uid of stillUnresolved) {
          const lidKey = normaliseLidJid(uid) ?? uid;
          const phone = byLid.get(lidKey);
          if (phone) phoneByUserId.set(uid, phone);
        }
      }
    }

    const distinctPhones = Array.from(new Set(phoneByUserId.values()));

    type ContactLite = {
      name?: string;
      phone?: string;
      whatsappNumber?: string;
      whatsappId?: string;
    };
    const contactByPhone = new Map<string, ContactLite>();
    if (distinctPhones.length > 0) {
      const contacts = (await (Contact as any)
        .find(
          // Tenant-scope the contact lookup (legacy-tolerant) — otherwise a
          // contact with the same phone under a DIFFERENT tenant could supply
          // its name into this tenant's chat list (cross-tenant identity leak).
          withTenantScope(req, {
            $or: [
              { phone: { $in: distinctPhones } },
              { whatsappNumber: { $in: distinctPhones } },
              { whatsappId: { $in: distinctPhones } },
            ],
          }),
          { name: 1, phone: 1, whatsappNumber: 1, whatsappId: 1 },
        )
        .lean()) as ContactLite[];
      for (const c of contacts) {
        for (const key of ['phone', 'whatsappNumber', 'whatsappId'] as const) {
          const v = (c[key] || '').replace(/\D/g, '');
          if (v && !contactByPhone.has(v)) contactByPhone.set(v, c);
        }
      }
    }

    // Format response
    const formattedConversations = conversations.map((conv: any) => {
      const phone = phoneByUserId.get(conv._id) ?? null;
      const contact = phone ? contactByPhone.get(phone) : undefined;
      const pushName: string | undefined = conv.lastMessage.metadata?.pushName;
      const displayName =
        contact?.name || pushName || fallbackJidLabel(conv._id);
      return {
        userId: conv._id,
        sessionId: conv.lastMessage.metadata?.sessionId ?? null,
        userInfo: {
          name: displayName,
          phone: phone ?? undefined,
          isUnresolved: !phone, // signals @lid / group / unknown to the UI
        },
        lastMessage: {
          _id: conv.lastMessage._id,
          userId: conv.lastMessage.userId,
          role: conv.lastMessage.role,
          type: conv.lastMessage.type,
          content: conv.lastMessage.content,
          mediaUrl: conv.lastMessage.mediaUrl,
          mediaMimeType: conv.lastMessage.mediaMimeType,
          mediaFileName: conv.lastMessage.mediaFileName,
          mediaSize: conv.lastMessage.mediaSize,
          timestamp: conv.lastMessage.timestamp,
          metadata: conv.lastMessage.metadata,
        },
        unreadCount: unreadMap.get(conv._id) || 0,
        messageCount: conv.messageCount,
      };
    });

    res.json({
      conversations: formattedConversations,
      total,
      limit,
      skip,
      hasMore: skip + formattedConversations.length < total,
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * GET /api/chat/messages/:userId
 * Get messages for a specific user conversation
 */
router.get('/messages/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const { limit = 100, before, sessionId } = req.query;

    // Build query
    const query: any = { userId: decodeURIComponent(userId) };

    if (before) {
      query.timestamp = { $lt: new Date(before as string) };
    }
    if (
      typeof sessionId === 'string' &&
      sessionId !== 'all' &&
      sessionId !== ''
    ) {
      query['metadata.sessionId'] = sessionId;
    }

    const messages = await ChatMessage.find(withTenantScope(req, query))
      .sort({ timestamp: 1 })
      .limit(Number(limit))
      .lean();

    res.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/chat/send
 * Send a message to a WhatsApp user from the admin panel
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { userId, message, sessionId = 'default' } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }

    // Resolve a live session: honour the requested one when it has a socket,
    // otherwise fall back to any active session. Multi-device deployments
    // often have no session literally named 'default', and pages like the
    // Follow-Up Manager don't know which device owns the conversation —
    // without this fallback every send from them 503s.
    const activeSessionId = resolveActiveSessionId(sessionId);
    if (!activeSessionId) {
      return res
        .status(503)
        .json({ error: 'No WhatsApp session is connected' });
    }

    // Mark all user messages as read (admin is viewing this chat)
    await ChatMessage.updateMany(
      withTenantScope(req, { userId, role: 'user', read: false }),
      { $set: { read: true } },
    );

    // Send message via WhatsApp
    const sent = await sendMessage(userId, message, activeSessionId);

    if (!sent) {
      return res.status(500).json({ error: 'Failed to send WhatsApp message' });
    }

    // Save message to database
    const savedMessage = await ChatMessage.create({
      userId,
      role: 'assistant',
      type: 'text',
      content: message,
      timestamp: new Date(),
      read: true, // Admin's messages are always read
      tenantId: tenantIdOf(req),
      metadata: {
        sessionId: activeSessionId,
        source: 'admin_panel',
      },
    });

    // Emit to WebSocket for real-time update
    try {
      getIO().emit('new-message', savedMessage);
    } catch (e) {
      console.error('Failed to emit socket event:', e);
    }

    res.json({
      success: true,
      message: {
        _id: savedMessage._id,
        userId: savedMessage.userId,
        role: savedMessage.role,
        type: savedMessage.type,
        content: savedMessage.content,
        timestamp: savedMessage.timestamp,
      },
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/** Send an attachment or browser-recorded voice note from Live Chat. */
router.post(
  '/send-media',
  mediaUpload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const {
        userId,
        sessionId = 'default',
        caption = '',
        kind = '',
      } = req.body;
      const file = req.file;
      if (!userId || !file) {
        return res.status(400).json({ error: 'userId and file are required' });
      }
      const activeSessionId = resolveActiveSessionId(sessionId);
      if (!activeSessionId) {
        return res
          .status(503)
          .json({ error: 'No WhatsApp session is connected' });
      }

      const mime = (file.mimetype || 'application/octet-stream')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (!SAFE_CHAT_UPLOAD_MIMES.has(mime)) {
        return res.status(415).json({ error: 'Unsupported attachment type' });
      }
      const messageType =
        kind === 'voice'
          ? 'voice'
          : mime.startsWith('image/')
            ? 'image'
            : mime.startsWith('video/')
              ? 'video'
              : mime.startsWith('audio/')
                ? 'voice'
                : 'document';

      const sent =
        kind === 'voice'
          ? await sendVoiceMessage(userId, file.buffer, activeSessionId)
          : await sendMediaMessage(
              userId,
              file.buffer,
              messageType === 'voice' ? 'audio' : messageType,
              {
                caption: String(caption).trim() || undefined,
                mimetype: mime,
                fileName: file.originalname,
              },
              activeSessionId,
            );
      if (!sent) {
        return res.status(500).json({ error: 'Failed to send WhatsApp media' });
      }

      const stored = await storeChatMedia(file.buffer, mime, file.originalname);
      const savedMessage = await ChatMessage.create({
        userId,
        role: 'assistant',
        type: messageType,
        content:
          String(caption).trim() ||
          (messageType === 'voice' ? 'Voice message' : file.originalname),
        ...stored,
        timestamp: new Date(),
        read: true,
        tenantId: tenantIdOf(req),
        metadata: { sessionId: activeSessionId, source: 'admin_panel' },
      });
      getIO().emit('new-message', savedMessage);
      return res.json({ success: true, message: savedMessage });
    } catch (error) {
      console.error('Error sending media:', error);
      return res.status(500).json({ error: 'Failed to send media' });
    }
  },
);

/**
 * GET /api/chat/status
 * Get WhatsApp connection status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const session = await Session.findOne({ sessionId: 'default' });

    res.json({
      connected: session?.status === 'connected',
      status: session?.status || 'disconnected',
      phoneNumber: session?.phoneNumber || null,
    });
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * POST /api/chat/mark-read/:userId
 * Mark all messages from a user as read
 */
router.post('/mark-read/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const decodedUserId = decodeURIComponent(
      Array.isArray(userId) ? userId[0] : userId,
    );

    // Mark all user messages as read
    const result = await ChatMessage.updateMany(
      withTenantScope(req, {
        userId: decodedUserId,
        role: 'user',
        read: false,
      }),
      { $set: { read: true } },
    );

    console.log(
      `📖 Marked ${result.modifiedCount} messages as read for user: ${decodedUserId}`,
    );

    // Emit socket event to notify other clients (if any) about read status update
    try {
      getIO().emit('messages-read', { userId: decodedUserId });
    } catch (e) {
      console.error('Failed to emit messages-read event:', e);
    }

    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('Error marking as read:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

/**
 * POST /api/chat/lid/map
 * Body: { userId: '<lid>@lid', phone: '+94771234567' }
 *
 * Manual LID → phone mapping written by the operator from the chat UI
 * when none of the automatic resolvers (Baileys senderPn, contact sync,
 * vCard parse, text extraction) caught the customer's real number. The
 * mapping is shared across all sessions — once an operator types it once,
 * the same LID resolves on every device the bot is connected to.
 *
 * Also rewrites ANY ChatMessage rows that share this userId so the back-
 * fill on the conversations endpoint picks it up immediately (no need to
 * wait for the next inbound message).
 */
router.post('/lid/map', async (req: AuthRequest, res: Response) => {
  try {
    const { userId, phone } = (req.body ?? {}) as {
      userId?: unknown;
      phone?: unknown;
    };
    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (typeof phone !== 'string' || !phone) {
      return res.status(400).json({ error: 'phone is required' });
    }
    const lidJid =
      normaliseLidJid(userId) ?? (isLidJid(userId) ? userId : null);
    if (!lidJid) {
      return res.status(400).json({
        error:
          'userId must be a Linked-ID (@lid) JID — phone-backed JIDs do not need mapping',
      });
    }
    const phoneInfo = normalisePhoneJid(phone);
    if (!phoneInfo) {
      return res
        .status(400)
        .json({ error: 'phone must be a valid 8-15 digit number (E.164)' });
    }

    const now = new Date();
    await LidPhoneMapping.updateOne(
      { lidJid },
      {
        $set: {
          lidJid,
          phoneJid: phoneInfo.phoneJid,
          phone: phoneInfo.phone,
          source: 'manual',
          lastSeenAt: now,
        },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true },
    );

    // Stamp realPhone on every ChatMessage for this LID so the chat list
    // resolves on the next refresh without waiting for new traffic.
    const stamped = await ChatMessage.updateMany(
      withTenantScope(req, { userId: lidJid }),
      { $set: { 'metadata.realPhone': phoneInfo.phone } },
    );

    res.json({
      success: true,
      lidJid,
      phone: phoneInfo.phone,
      messagesStamped: stamped.modifiedCount ?? 0,
    });
  } catch (error: any) {
    console.error('Error mapping LID to phone:', error);
    res
      .status(500)
      .json({ error: error?.message ?? 'Failed to map LID to phone' });
  }
});

export default router;
