import mongoose, { Schema, Document } from 'mongoose';
import { Channel } from '../types/agent';

export interface ICampaignExecution extends Document {
  tenantId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId;
  variantId: string;
  channel: Channel;
  recipientExternalId: string;
  contactId?: mongoose.Types.ObjectId;
  status:
    | 'queued'
    | 'sending'
    | 'sent'
    | 'delivered'
    | 'read'
    | 'replied'
    | 'bounced'
    | 'failed';
  /** Outcome attribution — set by feedback flywheel when conversion occurs. */
  outcome?: 'converted' | 'no_conversion' | 'opt_out' | null;
  attemptCount: number;
  externalMessageId?: string;
  errorMessage?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  repliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignExecutionSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'MarketingCampaign',
      required: true,
      index: true,
    },
    variantId: { type: String, required: true },
    channel: { type: String, required: true },
    recipientExternalId: { type: String, required: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    status: {
      type: String,
      enum: [
        'queued',
        'sending',
        'sent',
        'delivered',
        'read',
        'replied',
        'bounced',
        'failed',
      ],
      default: 'queued',
      index: true,
    },
    outcome: {
      type: String,
      enum: ['converted', 'no_conversion', 'opt_out', null],
      default: null,
    },
    attemptCount: { type: Number, default: 0 },
    externalMessageId: { type: String },
    errorMessage: { type: String },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    repliedAt: { type: Date },
  } as any,
  { timestamps: true },
);

CampaignExecutionSchema.index({ campaignId: 1, status: 1 });
CampaignExecutionSchema.index({ tenantId: 1, createdAt: -1 });
// Last-touch attribution looks up recent sends to a recipient (phone/JID).
CampaignExecutionSchema.index({ tenantId: 1, recipientExternalId: 1, createdAt: -1 });
// recordReply() matches the campaign message a reply belongs to.
CampaignExecutionSchema.index({ tenantId: 1, externalMessageId: 1 });

const __CampaignExecutionModel =
  mongoose.models.CampaignExecution ||
  mongoose.model('CampaignExecution', CampaignExecutionSchema as any);
export default __CampaignExecutionModel as unknown as mongoose.Model<ICampaignExecution>;
