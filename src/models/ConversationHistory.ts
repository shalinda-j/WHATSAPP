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
  expiresAt: Date;
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
  // userId used to be declared `unique: true` which capped the system to a
  // SINGLE conversation row per WhatsApp identity for the entire lifetime
  // of the deployment. Once the TTL retention created (then dropped) the
  // first row, subsequent inserts with the same userId raced against the
  // unique index. Indexing without uniqueness keeps lookups fast and lets
  // a user have multiple rolling history rows (e.g. across sessions /
  // tenants) without E11000.
  userId: {
    type: String,
    required: true,
    index: true,
  },
  messages: {
    type: [ConversationMessageSchema as any],
    default: [],
  },
  lastActivityAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
});

// TTL index for automatic cleanup of expired conversations
// Conversations expire based on expiresAt field
ConversationHistorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save hook to update expiresAt based on retention period
ConversationHistorySchema.pre('save', function (this: any) {
  this.expiresAt = new Date(
    Date.now() + CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
});

// Static method to get retention days
(ConversationHistorySchema as any).statics = {
  getRetentionDays: () => CONVERSATION_RETENTION_DAYS,
};

const ConversationHistory =
  mongoose.models.ConversationHistory ||
  (mongoose as any).model('ConversationHistory', ConversationHistorySchema);

export default ConversationHistory;
