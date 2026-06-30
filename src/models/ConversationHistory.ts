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
  tenantId?: mongoose.Types.ObjectId;
  messages: IConversationMessage[];
  lastActivityAt: Date;
  createdAt: Date;
}

// Default retention: 30 days (configurable via environment variable).
// Guard against a malformed env value (e.g. '30d'): parseInt would yield NaN,
// and NaN * 86400 makes MongoDB reject/ignore the TTL index so conversations
// would never expire. Fall back to 30 days and clamp to a sane minimum.
const CONVERSATION_RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.CONVERSATION_RETENTION_DAYS || '30', 10) || 30,
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
  // Writes are upserts on { userId, tenantId }. The compound unique index below
  // gives one rolling history row per (user, tenant) and keeps concurrent
  // first-message upserts dedup-safe (MongoDB auto-retries an upsert that hits
  // a duplicate-key error). userId is NO LONGER unique on its own: a customer
  // who messaged two tenants' WhatsApp numbers previously shared ONE history
  // row, so tenant A's turns leaked into tenant B's AI context.
  userId: {
    type: String,
    required: true,
  },
  // Multi-tenancy: which tenant owns this conversation. Optional so legacy rows
  // and single-tenant deployments keep working; TenantBootstrapService backfills
  // it on existing rows at boot, so scoped reads/writes still find them.
  tenantId: {
    type: (mongoose as any).Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true,
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

// One rolling history row per (user, tenant). Replaces the former userId-only
// unique index. NOTE: Mongoose does NOT auto-drop the legacy single-field
// `userId_1` unique index, and that old index would still block a second
// tenant from owning a row for the same JID. Single-tenant deployments are
// unaffected (one tenant ⇒ userId is effectively unique anyway). Operators
// enabling MULTI-TENANT must drop it once:
//   db.conversationhistories.dropIndex('userId_1')
ConversationHistorySchema.index({ userId: 1, tenantId: 1 }, { unique: true });

// Static method to get retention days
(ConversationHistorySchema as any).statics = {
  getRetentionDays: () => CONVERSATION_RETENTION_DAYS,
};

const ConversationHistory =
  mongoose.models.ConversationHistory ||
  (mongoose as any).model('ConversationHistory', ConversationHistorySchema);

export default ConversationHistory;
