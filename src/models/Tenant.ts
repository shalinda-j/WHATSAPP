import mongoose, { Schema, Document } from 'mongoose';

export interface ITenant extends Document {
  /** Stable slug used in API paths and channel routing. */
  slug: string;
  /** Display name shown in the admin UI. */
  name: string;
  /** Plan tier — informs billing + budget caps. */
  plan: 'free' | 'starter' | 'growth' | 'enterprise';
  /** Tenant-level status. Suspended tenants short-circuit on every API call. */
  status: 'active' | 'suspended' | 'archived';
  /** Marketing-facing brand profile reused by content/campaign agents. */
  brand: {
    industry?: string;
    voice?: string; // e.g. "warm, professional, Sinhala-first"
    primaryLanguage?: string;
    timezone?: string;
    websiteUrl?: string;
  };
  /** Per-tenant budget caps. Mirrors AgentConfig caps but tenant-wide. */
  budget: {
    dailyTokenCap: number;
    monthlyCostUsdCap: number;
    perConversationTokenCap: number;
  };
  /** Owner admin user id (references Admin collection). */
  ownerAdminId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    plan: {
      type: String,
      enum: ['free', 'starter', 'growth', 'enterprise'],
      default: 'free',
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'archived'],
      default: 'active',
      index: true,
    },
    brand: {
      industry: { type: String },
      voice: { type: String },
      primaryLanguage: { type: String, default: 'si' },
      timezone: { type: String, default: 'Asia/Colombo' },
      websiteUrl: { type: String },
    },
    budget: {
      dailyTokenCap: { type: Number, default: 1_000_000 },
      monthlyCostUsdCap: { type: Number, default: 100 },
      perConversationTokenCap: { type: Number, default: 8000 },
    },
    ownerAdminId: { type: Schema.Types.ObjectId, ref: 'Admin' },
  } as any,
  { timestamps: true },
);

export default mongoose.model(
  'Tenant',
  TenantSchema as any,
) as unknown as mongoose.Model<ITenant>;
