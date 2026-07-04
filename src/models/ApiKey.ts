import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

/**
 * ApiKey — a long-lived credential for EXTERNAL systems (e.g. the operator's
 * custom CRM) to pull data from the read-only /api/integrations/* endpoints
 * WITHOUT a short-lived admin JWT.
 *
 * Security model:
 *  - The raw key (`wbk_<40 hex>`) is shown to the operator EXACTLY ONCE at
 *    creation and never stored. We persist only its SHA-256 hash, so a DB dump
 *    can't recover a working key. Lookups hash the presented key and match the
 *    indexed hash (sha256 is fine here — the key is high-entropy, unlike a
 *    password, so bcrypt's slow hashing isn't needed and would break O(1) lookup).
 *  - `keyPrefix` (first 12 chars of the raw key) is stored purely for display so
 *    the operator can recognise a key in the list.
 *  - Tenant-scoped: the key carries its owning tenantId; the middleware resolves
 *    req.tenant from it so every integration read is isolated to that tenant.
 */
export type ApiKeyScope =
  | 'read:leads'
  | 'read:contacts'
  | 'read:bookings'
  | 'read:all';

export interface IApiKey extends Document {
  tenantId?: mongoose.Types.ObjectId;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  isActive: boolean;
  lastUsedAt?: Date;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** SHA-256 hex of a raw key — the stored/lookup form. */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/** Generate a fresh raw key (shown once) — `wbk_` + 40 hex chars. */
export function generateRawApiKey(): string {
  return `wbk_${crypto.randomBytes(20).toString('hex')}`;
}

const ApiKeySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
    name: { type: String, required: true },
    // Indexed + unique so an authenticated lookup is a single indexed hit and
    // two keys can't collide.
    keyHash: { type: String, required: true, unique: true, index: true },
    keyPrefix: { type: String, required: true },
    scopes: {
      type: [String],
      enum: ['read:leads', 'read:contacts', 'read:bookings', 'read:all'],
      default: ['read:all'],
    },
    isActive: { type: Boolean, default: true, index: true },
    lastUsedAt: { type: Date },
    createdBy: { type: String },
  } as any,
  { timestamps: true },
);

const __ApiKeyModel =
  mongoose.models.ApiKey || mongoose.model('ApiKey', ApiKeySchema as any);
export default __ApiKeyModel as unknown as mongoose.Model<IApiKey>;
