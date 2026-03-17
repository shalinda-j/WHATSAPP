import mongoose, { Document, Schema } from 'mongoose';

interface ISession {
  sessionId: string;
  sessionName?: string;
  status:
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'scan_qr'
    | 'reconnecting'
    | 'deleted';
  qr?: string;
  phoneNumber?: string;
  deleted?: boolean; // Flag to prevent auto-restart after deletion
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>({
  sessionId: { type: String, required: true, unique: true },
  sessionName: { type: String },
  status: {
    type: String,
    enum: [
      'connecting',
      'connected',
      'disconnected',
      'scan_qr',
      'reconnecting',
      'deleted',
    ],
    default: 'disconnected',
  },
  qr: { type: String },
  phoneNumber: { type: String },
  deleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Modern Mongoose 7+ pre-save hook (no 'next' callback needed for async)
SessionSchema.pre('save', async function () {
  this.updatedAt = new Date();
});

// Indexes for fast querying of active sessions
SessionSchema.index({ status: 1, updatedAt: -1 });
SessionSchema.index({ deleted: 1 });

const Session = mongoose.model(
  'Session',
  SessionSchema as any,
) as unknown as mongoose.Model<ISession>;

export default Session;
