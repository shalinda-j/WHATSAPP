import mongoose, { Document, Schema } from 'mongoose';

export interface IChatMessage {
  userId: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'voice' | 'image' | 'document';
  content: string;
  mediaUrl?: string;
  timestamp: Date;
  read?: boolean; // Track if message has been seen by admin
  questionCategory?: string;
  questionKeywords?: string[];
  metadata?: {
    sessionId?: string;
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
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  type: {
    type: String,
    enum: ['text', 'voice', 'image', 'document'],
    default: 'text',
  },
  content: { type: String, required: true },
  mediaUrl: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
  read: { type: Boolean, default: false, index: true }, // Track if message has been seen by admin
  questionCategory: { type: String, index: true },
  questionKeywords: [{ type: String }],
  metadata: {
    sessionId: { type: String },
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
// Sentiment analytics need to scan negative messages by recency. Sparse
// because most inbound messages stay neutral and we don't want to bloat
// the index with the neutral majority.
ChatMessageSchema.index(
  { 'metadata.sentimentLabel': 1, timestamp: -1 },
  { sparse: true },
);

const ChatMessage = mongoose.model(
  'ChatMessage',
  ChatMessageSchema as any,
) as any;

export default ChatMessage;
