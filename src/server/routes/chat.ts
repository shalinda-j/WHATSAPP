import { Router, Request, Response } from 'express';
import ChatMessage from '../../models/ChatMessage';
import Session from '../../models/Session';
import { sendMessage, getSocket } from '../../services/whatsapp';
import { getIO } from '../socket';
import { authenticateToken, AuthRequest } from '../middleware/auth';

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
    } = req.query as Record<string, string>;

    const minMsgs = Math.max(1, parseInt(minMessages, 10) || 1);
    const maxRows = Math.max(1, Math.min(parseInt(limit, 10) || 50000, 200000));

    // Build match filter:
    // - Always include only userIds that contain an '@' (real JIDs)
    // - Always exclude group/broadcast JIDs (@g.us / @broadcast / status@)
    // - Always require at least one digit before the '@'
    const baseMatch: any = {
      userId: {
        $regex: /^[+]?\d[\d]*@(?!g\.us|broadcast)/i,
      },
    };
    if (role === 'user' || role === 'assistant') {
      baseMatch.role = role;
    } else {
      // role='all' — include user + assistant (every direction proves contact).
      // Exclude pure 'system' messages.
      baseMatch.role = { $in: ['user', 'assistant'] };
    }

    // Sort spec for the group output
    const sortSpec: Record<string, 1 | -1> =
      sort === 'oldest'
        ? { lastSeen: 1 }
        : sort === 'active'
        ? { messageCount: -1, lastSeen: -1 }
        : { lastSeen: -1 }; // 'newest' (default)

    const rows = await ChatMessage.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: '$userId',
          messageCount: { $sum: 1 },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' },
          // pick the last *user-originated* content as the conversation hint
          lastMessage: { $last: '$content' },
          // counts per role for diagnostics
          inboundCount: {
            $sum: { $cond: [{ $eq: ['$role', 'user'] }, 1, 0] },
          },
          outboundCount: {
            $sum: { $cond: [{ $eq: ['$role', 'assistant'] }, 1, 0] },
          },
        },
      },
      { $match: { messageCount: { $gte: minMsgs } } },
      { $sort: sortSpec },
      { $limit: maxRows },
    ]);

    // Extract digits and validate — guard against group JIDs that slipped through.
    const seen = new Set<string>();
    const records = rows
      .map((r: any) => {
        const jid = String(r._id || '');
        // Group JIDs look like `123456-987@g.us` — reject any hyphen before '@'.
        const local = jid.split('@')[0] || '';
        if (local.includes('-')) return null;
        const phone = local.replace(/[^0-9]/g, '');
        if (!phone || phone.length < 8 || phone.length > 15) return null;
        if (seen.has(phone)) return null;
        seen.add(phone);
        return {
          phone,
          jid,
          messageCount: r.messageCount || 0,
          inboundCount: r.inboundCount || 0,
          outboundCount: r.outboundCount || 0,
          firstSeen: r.firstSeen ? new Date(r.firstSeen).toISOString() : '',
          lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : '',
          lastMessage: String(r.lastMessage || '')
            .replace(/\r?\n/g, ' ')
            .slice(0, 200),
        };
      })
      .filter(Boolean) as Array<{
      phone: string;
      jid: string;
      messageCount: number;
      inboundCount: number;
      outboundCount: number;
      firstSeen: string;
      lastSeen: string;
      lastMessage: string;
    }>;

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
 */
router.get(
  '/export-numbers/preview',
  async (_req: AuthRequest, res: Response) => {
    try {
      const stats = await ChatMessage.aggregate([
        {
          $match: {
            role: { $in: ['user', 'assistant'] },
            userId: { $regex: /^[+]?\d[\d]*@(?!g\.us|broadcast)/i },
          },
        },
        {
          $group: {
            _id: '$userId',
            messageCount: { $sum: 1 },
            lastSeen: { $max: '$timestamp' },
          },
        },
        {
          $group: {
            _id: null,
            uniqueContacts: { $sum: 1 },
            totalMessages: { $sum: '$messageCount' },
            mostRecent: { $max: '$lastSeen' },
          },
        },
      ]);

      const s = stats[0] || {
        uniqueContacts: 0,
        totalMessages: 0,
        mostRecent: null,
      };

      res.json({
        uniqueContacts: s.uniqueContacts,
        totalMessages: s.totalMessages,
        mostRecent: s.mostRecent,
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
