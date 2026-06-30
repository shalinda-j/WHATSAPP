import ConversationHistory, {
  IConversationMessage,
} from '../models/ConversationHistory';

/**
 * ConversationHistoryService
 * Manages persistent conversation storage with configurable retention
 */

// Default retention: 30 days (can be overridden via environment variable)
const DEFAULT_RETENTION_DAYS = parseInt(
  process.env.CONVERSATION_RETENTION_DAYS || '30',
  10,
);
const MAX_MESSAGES_PER_USER = 50; // Keep last 50 messages per user

export class ConversationHistoryService {
  private static instance: ConversationHistoryService;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): ConversationHistoryService {
    if (!ConversationHistoryService.instance) {
      ConversationHistoryService.instance = new ConversationHistoryService();
    }
    return ConversationHistoryService.instance;
  }

  /**
   * Build the identity filter. When a tenantId is supplied the history is
   * scoped to that tenant so the same customer JID contacting two tenants gets
   * SEPARATE histories (no cross-tenant AI-context leak). When omitted (legacy
   * callers) the filter is userId-only, preserving the prior behaviour.
   * `tenantId: undefined` would be stripped by Mongoose anyway, so we build the
   * object explicitly to be unambiguous.
   */
  private identityFilter(
    userId: string,
    tenantId?: unknown,
  ): Record<string, unknown> {
    return tenantId ? { userId, tenantId } : { userId };
  }

  /**
   * Get conversation history for a user
   */
  async getHistory(
    userId: string,
    tenantId?: unknown,
  ): Promise<IConversationMessage[]> {
    try {
      const conversation = await ConversationHistory.findOne(
        this.identityFilter(userId, tenantId),
      );
      if (!conversation) {
        return [];
      }
      return conversation.messages || [];
    } catch (error) {
      console.error('[ConversationHistory] Error getting history:', error);
      return [];
    }
  }

  /**
   * Add a message to conversation history
   */
  async addMessage(
    userId: string,
    role: 'system' | 'user' | 'assistant',
    content: string,
    tenantId?: unknown,
  ): Promise<void> {
    try {
      const message: IConversationMessage = {
        role,
        content,
        timestamp: new Date(),
      };

      // Atomic push + trim in a single update: $slice keeps only the last
      // MAX_MESSAGES_PER_USER entries after the push, so we never read the
      // whole array back into JS, mutate it, and save() — which was racy
      // (two concurrent addMessage calls could clobber each other's trim)
      // and pulled the full document over the wire on every message.
      // The upsert filter carries tenantId, so an inserted row is owned by the
      // right tenant (and matches the boot-backfilled existing rows).
      await ConversationHistory.findOneAndUpdate(
        this.identityFilter(userId, tenantId),
        {
          $push: {
            messages: { $each: [message], $slice: -MAX_MESSAGES_PER_USER },
          },
          $set: { lastActivityAt: new Date() },
        },
        { upsert: true },
      );
    } catch (error) {
      console.error('[ConversationHistory] Error adding message:', error);
    }
  }

  /**
   * Add multiple messages at once (for initial history)
   */
  async setInitialHistory(
    userId: string,
    messages: IConversationMessage[],
    tenantId?: unknown,
  ): Promise<void> {
    try {
      await ConversationHistory.findOneAndUpdate(
        this.identityFilter(userId, tenantId),
        {
          $set: {
            messages,
            lastActivityAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      console.error(
        '[ConversationHistory] Error setting initial history:',
        error,
      );
    }
  }

  /**
   * Clear conversation history for a user
   */
  async clearHistory(userId: string, tenantId?: unknown): Promise<boolean> {
    try {
      await ConversationHistory.deleteOne(
        this.identityFilter(userId, tenantId),
      );
      return true;
    } catch (error) {
      console.error('[ConversationHistory] Error clearing history:', error);
      return false;
    }
  }

  /**
   * Clear all conversation histories
   */
  async clearAllHistories(): Promise<number> {
    try {
      const result = await ConversationHistory.deleteMany({});
      return result.deletedCount || 0;
    } catch (error) {
      console.error(
        '[ConversationHistory] Error clearing all histories:',
        error,
      );
      return 0;
    }
  }

  /**
   * Get conversation count for monitoring
   */
  async getConversationCount(): Promise<number> {
    try {
      return await ConversationHistory.countDocuments();
    } catch (error) {
      console.error('[ConversationHistory] Error getting count:', error);
      return 0;
    }
  }

  /**
   * Get retention period in days
   */
  getRetentionDays(): number {
    return DEFAULT_RETENTION_DAYS;
  }

  /**
   * Extend conversation expiry (refresh TTL)
   */
  async extendExpiry(userId: string, tenantId?: unknown): Promise<void> {
    try {
      await ConversationHistory.findOneAndUpdate(
        this.identityFilter(userId, tenantId),
        { $set: { lastActivityAt: new Date() } },
      );
    } catch (error) {
      console.error('[ConversationHistory] Error extending expiry:', error);
    }
  }

  /**
   * Get statistics about conversation storage
   */
  async getStats(): Promise<{
    totalConversations: number;
    totalMessages: number;
    avgMessagesPerConversation: number;
    oldestConversation: Date | null;
    newestConversation: Date | null;
  }> {
    try {
      const stats = await ConversationHistory.aggregate([
        {
          $group: {
            _id: null,
            totalConversations: { $sum: 1 },
            totalMessages: { $sum: { $size: '$messages' } },
            oldestConversation: { $min: '$createdAt' },
            newestConversation: { $max: '$createdAt' },
          },
        },
      ]);

      if (stats.length === 0) {
        return {
          totalConversations: 0,
          totalMessages: 0,
          avgMessagesPerConversation: 0,
          oldestConversation: null,
          newestConversation: null,
        };
      }

      const data = stats[0];
      return {
        totalConversations: data.totalConversations,
        totalMessages: data.totalMessages,
        avgMessagesPerConversation:
          data.totalConversations > 0
            ? Math.round(data.totalMessages / data.totalConversations)
            : 0,
        oldestConversation: data.oldestConversation,
        newestConversation: data.newestConversation,
      };
    } catch (error) {
      console.error('[ConversationHistory] Error getting stats:', error);
      return {
        totalConversations: 0,
        totalMessages: 0,
        avgMessagesPerConversation: 0,
        oldestConversation: null,
        newestConversation: null,
      };
    }
  }
}

export const conversationHistoryService =
  ConversationHistoryService.getInstance();
export default conversationHistoryService;
