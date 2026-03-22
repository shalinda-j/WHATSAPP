import mongoose from 'mongoose';

/**
 * SessionState Model
 * Persists user session state across server restarts
 * Supports form, lead, and booking sessions
 */

export type SessionType = 'form' | 'lead' | 'booking';

export interface ISessionState {
  phoneNumber: string;
  type: SessionType;
  state: Record<string, any>;
  data: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

const SessionStateSchema = new (mongoose as any).Schema({
  phoneNumber: {
    type: String,
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['form', 'lead', 'booking'],
    required: true,
    index: true,
  },
  state: {
    type: Object,
    default: {},
  },
  data: {
    type: Object,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
});

// Compound index for efficient queries
SessionStateSchema.index({ phoneNumber: 1, type: 1 });

// TTL index for automatic cleanup of expired sessions
SessionStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save hook to update updatedAt
SessionStateSchema.pre('save', function(this: any) {
  this.updatedAt = new Date();
});

const SessionState = (mongoose as any).model('SessionState', SessionStateSchema);

export default SessionState;