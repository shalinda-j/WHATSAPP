import mongoose, { Document, Schema } from 'mongoose';

export interface IChatMessage {
  userId: string;
  /**
   * Owning tenant. Optional so existing/legacy writes keep compiling; stamped
   * at ingest points so chat-derived exports/analytics can scope by tenant.
   */
  tenantId?: mongoose.Types.ObjectId;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'voice' | 'image' | 'video' | 'document' | 'sticker';
  content: string;
  mediaUrl?: string;
  timestamp: Date;
  read?: boolean; // Track if message has been seen by admin
  /**
   * WhatsApp's own message id (`key.id`). Stamped by the live ingest and by
   * the history back-fill so a message that arrives through both paths
   * upserts onto one row instead of duplicating. Absent on rows written
   * before this field existed.
   */
  waMessageId?: string;
  questionCategory?: string;
  questionKeywords?: string[];
  metadata?: {
    sessionId?: string;
    /** Where the row came from — 'history_sync' marks a back-filled message. */
    source?: string;
    intent?: string;
    buyingSignal?: 'High' | 'Medium' | 'Low' | 'None';
    isBooking?: boolean;
    audioDuration?: number;
    isFirstMessage?: boolean;
    messageCount?: number;
    /** Heuristic sentiment computed inline at message ingest. */
    sentimentScore?: number;
    sentimentLabel?: 'positive' | 'neutral' | 'negative';
    /**
     * WhatsApp display name captured at ingest. Stored on the message so
     * the chat list + exports can resolve a human-readable label even
     * when the userId is a Linked-ID with no Contact match.
     */
    pushName?: string;
    /**
     * Real E.164-style phone digits resolved from the message at ingest.
     * For phone-backed JIDs this is the same digits the userId carries;
     * for `@lid` JIDs this is the real number lifted from
     * `message.key.senderPn` / `participantPn` (Baileys 6.6+). Empty when
     * the message arrived from a privacy-shielded LID with no fallback.
     */
    realPhone?: string;
  };
}

export type IChatMessageDocument = IChatMessage & Document;

const ChatMessageSchema = new Schema({
  userId: { type: String, required: true, index: true },
  // Owning tenant. Optional (no required) so existing writes keep working;
  // indexed so the tenant-scoped exports/analytics aggregations stay fast.
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  type: {
    type: String,
    enum: ['text', 'voice', 'image', 'video', 'document', 'sticker'],
    default: 'text',
  },
  content: { type: String, required: true },
  mediaUrl: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
  read: { type: Boolean, default: false, index: true }, // Track if message has been seen by admin
  // Sparse + unique: only rows that carry WhatsApp's message id participate,
  // so legacy rows (no id) are unaffected while the history back-fill gets a
  // hard guarantee it can never insert the same message twice.
  waMessageId: { type: String, index: true, unique: true, sparse: true },
  questionCategory: { type: String, index: true },
  questionKeywords: [{ type: String }],
  metadata: {
    sessionId: { type: String },
    source: { type: String },
    intent: { type: String },
    buyingSignal: {
      type: String,
      enum: ['High', 'Medium', 'Low', 'None'],
      default: 'None',
    },
    isBooking: { type: Boolean, default: false },
    audioDuration: { type: Number },
    isFirstMessage: { type: Boolean, default: false },
    messageCount: { type: Number, default: 1 },
    sentimentScore: { type: Number },
    sentimentLabel: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
    },
    pushName: { type: String },
    realPhone: { type: String, index: true },
  },
});

// Indexes for common queries
ChatMessageSchema.index({ userId: 1, timestamp: -1 });
ChatMessageSchema.index({ 'metadata.sessionId': 1, timestamp: -1 });
// Chat-history-by-session query: messages for a user within a session, newest first.
ChatMessageSchema.index({ userId: 1, 'metadata.sessionId': 1, timestamp: -1 });
// Sentiment analytics need to scan negative messages by recency. Sparse
// because most inbound messages stay neutral and we don't want to bloat
// the index with the neutral majority.
ChatMessageSchema.index(
  { 'metadata.sentimentLabel': 1, timestamp: -1 },
  { sparse: true },
);

const ChatMessage = (mongoose.models.ChatMessage ||
  mongoose.model('ChatMessage', ChatMessageSchema as any)) as any;

export default ChatMessage;
