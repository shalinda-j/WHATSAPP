import mongoose, { Schema, Document, Model } from 'mongoose';
import { CryptoService } from '../services/CryptoService';

export type WebhookCategory = 'data' | 'ops';
export type WebhookFormat = 'generic' | 'slack' | 'discord';

export interface IWebhook {
  url: string;
  events: string[]; // e.g., ['message.received', 'booking.created']
  secret?: string; // For verifying payloads
  isActive: boolean;
  name: string;
  /**
   * 'data' webhooks receive business events (message.received, lead.created).
   * 'ops' webhooks receive operational alerts (budget cap hit, approval
   * queue backlog, channel disconnect). The format determines the payload
   * shape so Slack / Discord incoming-webhook URLs work out of the box.
   */
  category?: WebhookCategory;
  format?: WebhookFormat;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IWebhookDocument extends IWebhook, Document {}

const WebhookSchema = new Schema(
  {
    // Multi-tenancy: which tenant owns this webhook subscription.
    // Optional so legacy webhooks stay functional under the route-level
    // $or filter until the tenant-backfill migration runs.
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
    name: { type: String, required: true },
    url: { type: String, required: true },
    events: { type: [String], default: [] },
    // HMAC signing secret — encrypted at rest via CryptoService (same pattern
    // as Config.apiKey). The getter decrypts on property access so
    // WebhookService's crypto.createHmac(..., webhook.secret) still signs with
    // the real value. Route responses must still REDACT it (getters don't run
    // on toObject/toJSON here, so serialization yields ciphertext, but we strip
    // it entirely — a secret must never leave the server).
    secret: {
      type: String,
      set: (val: string) => CryptoService.encrypt(val),
      get: (val: string) => CryptoService.decrypt(val),
    },
    isActive: { type: Boolean, default: true },
    category: {
      type: String,
      enum: ['data', 'ops'],
      default: 'data',
      index: true,
    },
    format: {
      type: String,
      enum: ['generic', 'slack', 'discord'],
      default: 'generic',
    },
  },
  { timestamps: true },
);

let Webhook: Model<any>;
if (mongoose.models.Webhook) {
  Webhook = mongoose.models.Webhook;
} else {
  Webhook = (mongoose.model as any)('Webhook', WebhookSchema as any);
}
export default Webhook;
