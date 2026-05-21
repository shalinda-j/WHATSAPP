import { Router, Request, Response } from 'express';
import ChatMessage from '../../models/ChatMessage';
import Session from '../../models/Session';
import Lead from '../../models/Lead';
import { Contact } from '../../models/CRM';
import { sendMessage, getSocket } from '../../services/whatsapp';
import { getIO } from '../socket';
import { authenticateToken, AuthRequest } from '../middleware/auth';

/**
 * Extract a clean phone number (8-15 digits) from any string. Handles:
 *   - "94712345678@s.whatsapp.net"  → "94712345678"
 *   - "94712345678:5@s.whatsapp.net" (device-qualified) → "94712345678"
 *   - "94712345678@c.us"            → "94712345678"
 *   - "+94 71 234 5678"             → "94712345678"
 *   - "94712345678-1234567@g.us"    → null (group JID)
 *   - "status@broadcast"            → null
 * Returns null when the input cannot be reduced to a valid mobile number.
 */
function extractPhoneFromUserId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Reject groups / broadcasts / status outright (case-insensitive suffix check)
  const lower = s.toLowerCase();
  if (lower.endsWith('@g.us')) return null;
  if (lower.endsWith('@broadcast')) return null;
  if (lower.startsWith('status@')) return null;

  // Take the part before '@' if there is one — that's the localpart of a JID.
  const localpart = s.includes('@') ? s.split('@')[0] : s;

  // Localpart containing '-' is a group leftover even without the @g.us suffix.
  if (localpart.includes('-')) return null;

  // Strip device qualifier (":5" trailing the user number on multi-device JIDs).
  const beforeColon = localpart.includes(':')
    ? localpart.split(':')[0]
    : localpart;

  // Keep only digits — handles "+", spaces, dashes that might have leaked in.
  const digits = beforeColon.replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

const router = Router();

// SECURITY FIX: All chat routes require authentication
router.use(authenticateToken);

/**
 * GET /api/chat/export-numbers
 * Export real mobile numbers from actual WhatsApp conversations.
 *
 * Aggregates EVERY unique customer JID that appears in ChatMessage history
 * (both messages they sent AND messages we sent to them — both prove the
 * number is real and was contacted). Strips the WhatsApp suffix, validates
 * the remaining digits as a phone number, and emits CSV/JSON sorted by date.
 *
 * Query params:
 *   format       = 'csv' | 'json'                 (default 'csv')
 *   sort         = 'newest' | 'oldest' | 'active' (default 'newest' — date order)
 *   role         = 'all' | 'user' | 'assistant'   (default 'all')
 *   includeStats = 'true' | 'false'               (default 'true')
 *   minMessages  = number                         (default 1)
 *   limit        = number                         (default 50000)
 */
router.get('/export-numbers', async (req: AuthRequest, res: Response) => {
  try {
    const {
      format = 'csv',
      sort = 'newest',
      role = 'all',
      includeStats = 'true',
      minMessages = '1',
      limit = '50000',
      includeLeads = 'true',
      includeContacts = 'true',
    } = req.query as Record<string, string>;

    const minMsgs = Math.max(1, parseInt(minMessages, 10) || 1);
    const maxRows = Math.max(1, Math.min(parseInt(limit, 10) || 50000, 200000));

    // Build match WITHOUT any MongoDB-side userId regex (the previous regex
    // silently dropped device-qualified JIDs and other valid formats, which is
    // why the CSV came back empty). All filtering now happens in JS where it
    // is easy to debug and impossible to miss valid contacts.
    const baseMatch: any = {};
    if (role === 'user' || role === 'assistant') {
      baseMatch.role = role;
    } else {
      baseMatch.role = { $in: ['user', 'assistant'] };
    }

    const rows = await ChatMessage.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: '$userId',
          messageCount: { $sum: 1 },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' },
          lastMessage: { $last: '$content' },
          inboundCount: {
            $sum: { $cond: [{ $eq: ['$role', 'user'] }, 1, 0] },
          },
          outboundCount: {
            $sum: { $cond: [{ $eq: ['$role', 'assistant'] }, 1, 0] },
          },
        },
      },
      { $match: { messageCount: { $gte: minMsgs } } },
    ]);

    // JS-level validation: every userId is run through the JID parser. This
    // catches device-qualified JIDs (94...@s.whatsapp.net with :N device tag),
    // @c.us (older WhatsApp), and dedupes by phone number across formats.
    const byPhone = new Map<
      string,
      {
        phone: string;
        jid: string;
        messageCount: number;
        inboundCount: number;
        outboundCount: number;
        firstSeen: string;
        lastSeen: string;
        lastMessage: string;
        sources: string[];
      }
    >();

    for (const r of rows) {
      const phone = extractPhoneFromUserId(r._id);
      if (!phone) continue;
      const existing = byPhone.get(phone);
      const firstSeen = r.firstSeen
        ? new Date(r.firstSeen).toISOString()
        : '';
      const lastSeen = r.lastSeen ? new Date(r.lastSeen).toISOString() : '';
      if (existing) {
        // Same number reported under two JID variants — merge counts.
        existing.messageCount += r.messageCount || 0;
        existing.inboundCount += r.inboundCount || 0;
        existing.outboundCount += r.outboundCount || 0;
        if (firstSeen && (!existing.firstSeen || firstSeen < existing.firstSeen)) {
          existing.firstSeen = firstSeen;
        }
        if (lastSeen && (!existing.lastSeen || lastSeen > existing.lastSeen)) {
          existing.lastSeen = lastSeen;
          existing.lastMessage = String(r.lastMessage || '')
            .replace(/\r?\n/g, ' ')
            .slice(0, 200);
        }
      } else {
        byPhone.set(phone, {
          phone,
          jid: String(r._id || ''),
          messageCount: r.messageCount || 0,
          inboundCount: r.inboundCount || 0,
          outboundCount: r.outboundCount || 0,
          firstSeen,
          lastSeen,
          lastMessage: String(r.lastMessage || '')
            .replace(/\r?\n/g, ' ')
            .slice(0, 200),
          sources: ['chat'],
        });
      }
    }

    // Multi-source fallback: pull in registered leads (real phone numbers
    // from the registration flow) so the export always returns real data
    // even if chat history hasn't accumulated yet.
    if (includeLeads !== 'false') {
      try {
        const leads = await Lead.find(
          {},
          { phoneNumber: 1, registeredAt: 1, fullName: 1, updatedAt: 1 },
        )
          .sort({ registeredAt: -1 })
          .lean();
        for (const l of leads as any[]) {
          const phone = extractPhoneFromUserId(l.phoneNumber);
          if (!phone) continue;
          const ts = l.updatedAt || l.registeredAt || new Date();
          const iso = new Date(ts).toISOString();
          const existing = byPhone.get(phone);
          if (existing) {
            if (!existing.sources.includes('lead')) existing.sources.push('lead');
            if (!existing.lastSeen || iso > existing.lastSeen) {
              existing.lastSeen = iso;
            }
            if (!existing.firstSeen || iso < existing.firstSeen) {
              existing.firstSeen = iso;
            }
          } else {
            byPhone.set(phone, {
              phone,
              jid: '',
              messageCount: 0,
              inboundCount: 0,
              outboundCount: 0,
              firstSeen: iso,
              lastSeen: iso,
              lastMessage: l.fullName ? `[Registered lead: ${l.fullName}]` : '',
              sources: ['lead'],
            });
          }
        }
      } catch (e) {
        console.warn('Lead source pull failed (non-fatal):', e);
      }
    }

    // CRM contacts (manual entries + auto-registered from chat)
    if (includeContacts !== 'false') {
      try {
        const contacts = await Contact.find(
          {},
          { phone: 1, name: 1, updatedAt: 1, createdAt: 1 },
        )
          .sort({ updatedAt: -1 })
          .lean();
        for (const c of contacts as any[]) {
          const phone = extractPhoneFromUserId(c.phone);
          if (!phone) continue;
          const ts = c.updatedAt || c.createdAt || new Date();
          const iso = new Date(ts).toISOString();
          const existing = byPhone.get(phone);
          if (existing) {
            if (!existing.sources.includes('contact'))
              existing.sources.push('contact');
            if (!existing.lastSeen || iso > existing.lastSeen) {
              existing.lastSeen = iso;
            }
            if (!existing.firstSeen || iso < existing.firstSeen) {
              existing.firstSeen = iso;
            }
          } else {
            byPhone.set(phone, {
              phone,
              jid: '',
              messageCount: 0,
              inboundCount: 0,
              outboundCount: 0,
              firstSeen: iso,
              lastSeen: iso,
              lastMessage: c.name ? `[CRM contact: ${c.name}]` : '',
              sources: ['contact'],
            });
          }
        }
      } catch (e) {
        console.warn('Contact source pull failed (non-fatal):', e);
      }
    }

    // Final sort across the merged set
    const allRecords = Array.from(byPhone.values());
    if (sort === 'oldest') {
      allRecords.sort((a, b) =>
        (a.lastSeen || '').localeCompare(b.lastSeen || ''),
      );
    } else if (sort === 'active') {
      allRecords.sort(
        (a, b) =>
          (b.messageCount || 0) - (a.messageCount || 0) ||
          (b.lastSeen || '').localeCompare(a.lastSeen || ''),
      );
    } else {
      // newest (default)
      allRecords.sort((a, b) =>
        (b.lastSeen || '').localeCompare(a.lastSeen || ''),
      );
    }

    const records = allRecords.slice(0, maxRows);

    if (format === 'json') {
      return res.json({
        total: records.length,
        sort,
        role,
        minMessages: minMsgs,
        contacts: records,
      });
    }

    const csvEscape = (s: string) =>
      `"${(s || '').toString().replace(/"/g, '""')}"`;

    const withStats = includeStats !== 'false';
    const header = withStats
      ? [
          'phone',
          'whatsapp_id',
          'sources',
          'message_count',
          'inbound_count',
          'outbound_count',
          'first_seen',
          'last_seen',
          'last_message',
        ]
      : ['phone'];

    // UTF-8 BOM so Excel opens Sinhala/Tamil text cleanly
    const BOM = '﻿';
    const lines = [header.join(',')];
    for (const r of records) {
      const row = withStats
        ? [
            r.phone,
            csvEscape(r.jid),
            csvEscape(r.sources.join('|')),
            String(r.messageCount),
            String(r.inboundCount),
            String(r.outboundCount),
            r.firstSeen,
            r.lastSeen,
            csvEscape(r.lastMessage),
          ]
        : [r.phone];
      lines.push(row.join(','));
    }

    const stamp = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Export-Total', String(records.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="whatsapp-live-chat-numbers-${stamp}.csv"`,
    );
    res.send(BOM + lines.join('\r\n'));
  } catch (error) {
    console.error('Error exporting chat numbers:', error);
    res.status(500).json({ error: 'Failed to export chat numbers' });
  }
});

/**
 * GET /api/chat/export-numbers/preview
 * Lightweight diagnostic — returns counts so the UI can show the user
 * exactly how many numbers will be exported before downloading.
 *
 * IMPORTANT: This endpoint uses the SAME JS validation as the export so
 * the preview count always matches the CSV row count. No silent regex
 * exclusions.
 */
router.get(
  '/export-numbers/preview',
  async (_req: AuthRequest, res: Response) => {
    try {
      // Pull every chat userId — no MongoDB-side regex filter. We validate
      // in JS to mirror the export behaviour exactly.
      const rows = await ChatMessage.aggregate([
        { $match: { role: { $in: ['user', 'assistant'] } } },
        {
          $group: {
            _id: '$userId',
            messageCount: { $sum: 1 },
            lastSeen: { $max: '$timestamp' },
          },
        },
      ]);

      const totalChatMessages = await ChatMessage.estimatedDocumentCount();

      const valid = new Set<string>();
      const rejectedGroups: string[] = [];
      const rejectedOther: string[] = [];
      let totalMessages = 0;
      let mostRecent: Date | null = null;

      for (const r of rows) {
        totalMessages += r.messageCount || 0;
        const raw = String(r._id || '');
        const phone = extractPhoneFromUserId(raw);
        if (phone) {
          valid.add(phone);
          if (r.lastSeen && (!mostRecent || r.lastSeen > mostRecent)) {
            mostRecent = r.lastSeen;
          }
        } else {
          const lower = raw.toLowerCase();
          if (
            lower.endsWith('@g.us') ||
            lower.endsWith('@broadcast') ||
            lower.startsWith('status@')
          ) {
            if (rejectedGroups.length < 3) rejectedGroups.push(raw);
          } else if (rejectedOther.length < 3) {
            rejectedOther.push(raw);
          }
        }
      }

      // Also count leads & contacts that the export would merge in
      let leadCount = 0;
      let contactCount = 0;
      try {
        const leads = await Lead.find({}, { phoneNumber: 1 }).lean();
        for (const l of leads as any[]) {
          const phone = extractPhoneFromUserId(l.phoneNumber);
          if (phone && !valid.has(phone)) {
            leadCount++;
            valid.add(phone);
          } else if (phone) {
            // already counted via chat — don't double-count
          }
        }
        const contacts = await Contact.find({}, { phone: 1 }).lean();
        for (const c of contacts as any[]) {
          const phone = extractPhoneFromUserId(c.phone);
          if (phone && !valid.has(phone)) {
            contactCount++;
            valid.add(phone);
          }
        }
      } catch (e) {
        console.warn('Lead/Contact preview pull failed (non-fatal):', e);
      }

      res.json({
        uniqueContacts: valid.size,
        totalMessages,
        totalChatMessages,
        mostRecent,
        diagnostics: {
          uniqueUserIdsInChat: rows.length,
          fromChatHistory: Math.max(
            0,
            valid.size - leadCount - contactCount,
          ),
          fromLeads: leadCount,
          fromContacts: contactCount,
          rejectedGroupSamples: rejectedGroups,
          rejectedOtherSamples: rejectedOther,
        },
      });
    } catch (error) {
      console.error('Error in export preview:', error);
      res
        .status(500)
        .json({ error: 'Failed to preview export', uniqueContacts: 0 });
    }
  },
);

/**
 * GET /api/chat/conversations
 * Get list of unique conversations with last message and unread count
 */
router.get('/conversations', async (req: AuthRequest, res: Response) => {
  try {
    // Aggregate to get unique users with their last message
    const conversations = await ChatMessage.aggregate([
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
        $sort: { 'lastMessage.timestamp': -1 },
      },
      {
        $limit: 100,
      },
    ]);

    // Get unread counts (messages from user that haven't been read by admin)
    const unreadCounts = await ChatMessage.aggregate([
      {
        $match: { role: 'user', read: { $ne: true } },
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

    // Format response
    const formattedConversations = conversations.map((conv: any) => ({
      userId: conv._id,
      lastMessage: {
        _id: conv.lastMessage._id,
        userId: conv.lastMessage.userId,
        role: conv.lastMessage.role,
        type: conv.lastMessage.type,
        content: conv.lastMessage.content,
        timestamp: conv.lastMessage.timestamp,
        metadata: conv.lastMessage.metadata,
      },
      unreadCount: unreadMap.get(conv._id) || 0,
      messageCount: conv.messageCount,
    }));

    res.json({ conversations: formattedConversations });
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
    const { limit = 100, before } = req.query;

    // Build query
    const query: any = { userId: decodeURIComponent(userId) };

    if (before) {
      query.timestamp = { $lt: new Date(before as string) };
    }

    const messages = await ChatMessage.find(query)
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

    // Check if WhatsApp is connected
    const socket = getSocket(sessionId);
    if (!socket) {
      return res.status(503).json({ error: 'WhatsApp session not connected' });
    }

    // Mark all user messages as read (admin is viewing this chat)
    await ChatMessage.updateMany(
      { userId, role: 'user', read: false },
      { $set: { read: true } },
    );

    // Send message via WhatsApp
    const sent = await sendMessage(userId, message, sessionId);

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
      metadata: {
        sessionId,
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
      { userId: decodedUserId, role: 'user', read: false },
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

export default router;
