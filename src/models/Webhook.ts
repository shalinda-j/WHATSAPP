import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IWebhook {
  url: string;
  events: string[]; // e.g., ['message.received', 'booking.created']
  secret?: string; // For verifying payloads
  isActive: boolean;
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IWebhookDocument extends IWebhook, Document {}

const WebhookSchema = new Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    events: { type: [String], default: [] },
    secret: { type: String },
    isActive: { type: Boolean, default: true },
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
