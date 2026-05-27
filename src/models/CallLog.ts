import mongoose, { Schema, Document } from 'mongoose';

export interface ICallLog extends Document {
  tenantId?: mongoose.Types.ObjectId;
  sessionId: string;
  callerId: string;
  callerName?: string;
  callerPhone?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: 'answered' | 'missed' | 'rejected' | 'busy';
  direction: 'incoming' | 'outgoing';
  aiResponseText?: string;
  aiResponseAudioUrl?: string;
  language?: 'en' | 'si' | 'ta';
  transcription?: string;
  notes?: string;
  createdAt: Date;
}

const CallLogSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
    sessionId: { type: String, required: true, index: true },
    callerId: { type: String, required: true, index: true },
    callerName: { type: String },
    callerPhone: { type: String },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    duration: { type: Number },
    status: {
      type: String,
      enum: ['answered', 'missed', 'rejected', 'busy'],
      default: 'missed',
    },
    direction: {
      type: String,
      enum: ['incoming', 'outgoing'],
      default: 'incoming',
    },
    aiResponseText: { type: String },
    aiResponseAudioUrl: { type: String },
    language: { type: String, enum: ['en', 'si', 'ta'], default: 'en' },
    transcription: { type: String },
    notes: { type: String },
  },
  { timestamps: true },
);

export default mongoose.models.CallLog ||
  mongoose.model('CallLog', CallLogSchema as any);
