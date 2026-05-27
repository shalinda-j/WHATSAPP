import mongoose, { Schema, Document } from 'mongoose';
import { Channel } from '../types/agent';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type CampaignTriggerKind =
  | 'manual'
  | 'scheduled'
  | 'behaviour'
  | 'lead_status_change';

export interface ICampaignVariant {
  variantId: string;
  weight: number; // 0–100, sums per campaign should equal 100
  messageBody: string;
  mediaUrl?: string;
  generatedBy?: 'human' | 'campaign_generator_agent';
}

export interface IMarketingCampaign extends Document {
  tenantId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  channels: Channel[];
  segmentId?: mongoose.Types.ObjectId;
  trigger: {
    kind: CampaignTriggerKind;
    scheduledAt?: Date;
    cron?: string;
    behaviourRule?: Record<string, unknown>;
    leadStatusFrom?: string;
    leadStatusTo?: string;
  };
  variants: ICampaignVariant[];
  status: CampaignStatus;
  /** Throttle to avoid spam — max messages per minute across all channels. */
  rateLimitPerMinute: number;
  /** Sender's local quiet hours (no messages between these times). */
  quietHours?: { startHour: number; endHour: number };
  /** Live aggregate stats refreshed by CampaignService. */
  stats: {
    queued: number;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    bounced: number;
    converted: number;
  };
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VariantSchema = new Schema(
  {
    variantId: { type: String, required: true },
    weight: { type: Number, default: 100, min: 0, max: 100 },
    messageBody: { type: String, required: true },
    mediaUrl: { type: String },
    generatedBy: {
      type: String,
      enum: ['human', 'campaign_generator_agent'],
      default: 'human',
    },
  },
  { _id: false },
);

const MarketingCampaignSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String },
    channels: [{ type: String }],
    segmentId: { type: Schema.Types.ObjectId, ref: 'ContactSegment' },
    trigger: {
      kind: {
        type: String,
        enum: ['manual', 'scheduled', 'behaviour', 'lead_status_change'],
        default: 'manual',
      },
      scheduledAt: { type: Date },
      cron: { type: String },
      behaviourRule: { type: Schema.Types.Mixed },
      leadStatusFrom: { type: String },
      leadStatusTo: { type: String },
    },
    variants: [VariantSchema],
    status: {
      type: String,
      enum: [
        'draft',
        'scheduled',
        'running',
        'paused',
        'completed',
        'cancelled',
      ],
      default: 'draft',
      index: true,
    },
    rateLimitPerMinute: { type: Number, default: 30 },
    quietHours: {
      startHour: { type: Number, min: 0, max: 23 },
      endHour: { type: Number, min: 0, max: 23 },
    },
    stats: {
      queued: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      replied: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
      converted: { type: Number, default: 0 },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  } as any,
  { timestamps: true },
);

MarketingCampaignSchema.index({ tenantId: 1, status: 1 });
MarketingCampaignSchema.index({ tenantId: 1, 'trigger.scheduledAt': 1 });

const __MarketingCampaignModel =
  mongoose.models.MarketingCampaign ||
  mongoose.model('MarketingCampaign', MarketingCampaignSchema as any);
export default __MarketingCampaignModel as unknown as mongoose.Model<IMarketingCampaign>;
