import mongoose, { Schema, Document } from 'mongoose';

/**
 * One row per sign-in ATTEMPT — successful or not.
 *
 * Why this isn't AuditEvent: the audit middleware records authenticated,
 * state-changing calls. A login has no authenticated user yet, and the
 * interesting rows are the FAILURES — a burst of `invalid_password` against
 * one account at 3am is the whole point of having this. So attempts are
 * recorded here with the username as typed, which is what lets an operator
 * tell "Nimal mistyped his password twice" from "someone is guessing at
 * Nimal's account from an IP we've never seen".
 *
 * The password is never stored, in any form, for any outcome.
 */
export type LoginOutcome =
  'success' | 'invalid_password' | 'unknown_user' | 'account_disabled';

export interface ILoginEvent extends Document {
  /** Set whenever the username matched a real account, even on failure. */
  adminId?: mongoose.Types.ObjectId;
  /** The username exactly as typed — the only record of a bad-username try. */
  username: string;
  outcome: LoginOutcome;
  ip?: string;
  userAgent?: string;
  /** The account's role at the moment of the attempt. */
  roleKey?: string;
  tenantId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const LoginEventSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin', index: true },
    username: { type: String, required: true, index: true },
    outcome: {
      type: String,
      enum: ['success', 'invalid_password', 'unknown_user', 'account_disabled'],
      required: true,
      index: true,
    },
    ip: { type: String },
    userAgent: { type: String },
    roleKey: { type: String },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
  } as any,
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The three ways the history is read: one user's timeline, the whole
// workspace's timeline, and "show me only the failures".
LoginEventSchema.index({ adminId: 1, createdAt: -1 });
LoginEventSchema.index({ tenantId: 1, createdAt: -1 });
LoginEventSchema.index({ outcome: 1, createdAt: -1 });
LoginEventSchema.index({ createdAt: -1 });

/**
 * TTL: 180 days by default. Every sign-in writes a row, so without this the
 * collection grows forever. Six months covers "who was in the panel when
 * that happened" for practically every real investigation; override with
 * LOGIN_HISTORY_RETENTION_DAYS.
 */
const RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.LOGIN_HISTORY_RETENTION_DAYS || '180', 10) || 180,
);
LoginEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
);

const __LoginEventModel =
  mongoose.models.LoginEvent ||
  mongoose.model('LoginEvent', LoginEventSchema as any);
export default __LoginEventModel as unknown as mongoose.Model<ILoginEvent>;
