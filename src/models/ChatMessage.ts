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
  },
});

// Indexes for common queries
ChatMessageSchema.index({ userId: 1, timestamp: -1 });
ChatMessageSchema.index({ 'metadata.sessionId': 1, timestamp: -1 });

const ChatMessage = mongoose.model(
  'ChatMessage',
  ChatMessageSchema as any,
) as any;

export default ChatMessage;
