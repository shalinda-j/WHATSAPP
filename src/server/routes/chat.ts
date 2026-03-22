import { Router, Request, Response } from 'express';
import ChatMessage from '../../models/ChatMessage';
import Session from '../../models/Session';
import { sendMessage, getSocket } from '../../services/whatsapp';
import { getIO } from '../socket';

const router = Router();

/**
 * GET /api/chat/conversations
 * Get list of unique conversations with last message and unread count
 */
router.get('/conversations', async (req: Request, res: Response) => {
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
      { $set: { read: true } }
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
    const decodedUserId = decodeURIComponent(Array.isArray(userId) ? userId[0] : userId);

    // Mark all user messages as read
    const result = await ChatMessage.updateMany(
      { userId: decodedUserId, role: 'user', read: false },
      { $set: { read: true } }
    );

    console.log(`📖 Marked ${result.modifiedCount} messages as read for user: ${decodedUserId}`);

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
