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
  /**
   * Tenant-wide quiet hours. When set, the campaign sender + follow-up
   * scheduler skip outbound sends whose local time falls inside the
   * window. Per-campaign quietHours still take precedence when present.
   * Falls back to brand.timezone when zone is unset.
   */
  quietHours?: {
    enabled: boolean;
    startHour: number;
    endHour: number;
    timezone?: string;
  };
  /**
   * Optional IP allowlist. When non-empty, every authenticated admin API
   * request must originate from one of the listed CIDR ranges (or exact
   * IPs). Empty array = open access from any source (default).
   */
  ipAllowlist?: string[];
  /**
   * Per-tenant inactive-session timeout in minutes. When set, the admin
   * UI's idle watchdog refreshes against the JWT token's `iat` claim
   * and forces a re-login when (now - iat) exceeds this value.
   */
  sessionTimeoutMinutes?: number;
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
    quietHours: {
      enabled: { type: Boolean, default: false },
      startHour: { type: Number, min: 0, max: 23, default: 21 },
      endHour: { type: Number, min: 0, max: 23, default: 8 },
      timezone: { type: String },
    },
    ipAllowlist: { type: [String], default: [] },
    sessionTimeoutMinutes: { type: Number },
    ownerAdminId: { type: Schema.Types.ObjectId, ref: 'Admin' },
  } as any,
  { timestamps: true },
);

export default mongoose.model(
  'Tenant',
  TenantSchema as any,
) as unknown as mongoose.Model<ITenant>;
