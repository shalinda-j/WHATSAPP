import { Router, Request, Response } from 'express';
import ChatMessage from '../../models/ChatMessage';
import Session from '../../models/Session';
import { Contact } from '../../models/CRM';
import { sendMessage, getSocket } from '../../services/whatsapp';
import { getIO } from '../socket';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { extractRealPhone, fallbackJidLabel } from '../../utils/jid';

const router = Router();

// SECURITY FIX: All chat routes require authentication + tenant context.
router.use(authenticateToken);
router.use(resolveTenant);

/**
 * GET /api/chat/conversations
 * Get list of unique conversations with last message and unread count.
 * Optional `?sessionId=X` scopes the result to a specific device when an
 * operator wants to see only one WhatsApp session's chats at a time.
 */
router.get('/conversations', async (req: AuthRequest, res: Response) => {
  try {
    const sessionId =
      typeof req.query.sessionId === 'string' &&
      req.query.sessionId !== 'all' &&
      req.query.sessionId !== ''
        ? req.query.sessionId
        : null;

    const baseMatch: Record<string, unknown> = {};
    if (sessionId) baseMatch['metadata.sessionId'] = sessionId;

    // Aggregate to get unique users with their last message
    const conversations = await ChatMessage.aggregate([
      ...(sessionId ? [{ $match: baseMatch }] : []),
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
        $match: {
          role: 'user',
          read: { $ne: true },
          ...(sessionId ? { 'metadata.sessionId': sessionId } : {}),
        },
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
    // bounded Contact query — much cheaper than a per-row findOne. LIDs
    // (@lid suffix) can't be looked up by phone; for those we fall back
    // to the pushName captured on the last message.
    const phoneByUserId = new Map<string, string>();
    for (const conv of conversations as Array<{ _id: string }>) {
      const phone = extractRealPhone(conv._id);
      if (phone) phoneByUserId.set(conv._id, phone);
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
          {
            $or: [
              { phone: { $in: distinctPhones } },
              { whatsappNumber: { $in: distinctPhones } },
              { whatsappId: { $in: distinctPhones } },
            ],
          },
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
          timestamp: conv.lastMessage.timestamp,
          metadata: conv.lastMessage.metadata,
        },
        unreadCount: unreadMap.get(conv._id) || 0,
        messageCount: conv.messageCount,
      };
    });

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
