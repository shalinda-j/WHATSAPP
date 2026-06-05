import mongoose, { Document, Schema } from 'mongoose';

interface ISession {
  sessionId: string;
  // Optional owning tenant. Forward-compatible scaffolding for finding #66:
  // new sessions are stamped with their tenant so a future migration can make
  // sessionId per-tenant unique. sessionId stays globally unique for now (no
  // migration required) — see docs/SESSION-MULTITENANCY.md.
  tenantId?: mongoose.Types.ObjectId;
  sessionName?: string;
  status:
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'scan_qr'
    | 'reconnecting'
    | 'deleted'
    | 'loggedOut';
  qr?: string;
  phoneNumber?: string;
  deleted?: boolean; // Flag to prevent auto-restart after deletion
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>({
  sessionId: { type: String, required: true, unique: true },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
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
      'loggedOut',
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

const Session = (mongoose.models.Session ||
  mongoose.model(
    'Session',
    SessionSchema as any,
  )) as unknown as mongoose.Model<ISession>;

export default Session;
