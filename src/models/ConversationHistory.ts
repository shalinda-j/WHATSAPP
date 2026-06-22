import mongoose from 'mongoose';

/**
 * ConversationHistory Model
 * Persists AI conversation history across server restarts
 * Supports configurable retention period via TTL index
 */

export interface IConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface IConversationHistory {
  userId: string;
  messages: IConversationMessage[];
  lastActivityAt: Date;
  createdAt: Date;
}

// Default retention: 30 days (configurable via environment variable)
const CONVERSATION_RETENTION_DAYS = parseInt(
  process.env.CONVERSATION_RETENTION_DAYS || '30',
  10,
);

const ConversationMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['system', 'user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const ConversationHistorySchema = new (mongoose as any).Schema({
  // All writes are upserts on { userId }. The unique constraint guarantees a
  // single rolling history row per identity and makes concurrent first-message
  // upserts dedup-safe (MongoDB auto-retries an upsert that hits a
  // duplicate-key error on the unique field).
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  messages: {
    type: [ConversationMessageSchema as any],
    default: [],
  },
  lastActivityAt: {
    type: Date,
    default: Date.now,
    // Indexed via the TTL index declared below (a single index on this key
    // serves both expiry and range/sort lookups).
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// TTL index for automatic cleanup of stale conversations. lastActivityAt is
// $set on every addMessage/setInitialHistory upsert, so documents expire
// CONVERSATION_RETENTION_DAYS after the last activity.
ConversationHistorySchema.index(
  { lastActivityAt: 1 },
  { expireAfterSeconds: CONVERSATION_RETENTION_DAYS * 86400 },
);

// Static method to get retention days
(ConversationHistorySchema as any).statics = {
  getRetentionDays: () => CONVERSATION_RETENTION_DAYS,
};

const ConversationHistory =
  mongoose.models.ConversationHistory ||
  (mongoose as any).model('ConversationHistory', ConversationHistorySchema);

export default ConversationHistory;
