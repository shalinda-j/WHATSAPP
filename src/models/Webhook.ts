import mongoose, { Schema, Document } from 'mongoose';

export interface IWebhook extends Document {
    url: string;
    events: string[]; // e.g., ['message.received', 'booking.created']
    secret?: string; // For verifying payloads
    isActive: boolean;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}

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

const Webhook = mongoose.models.Webhook || mongoose.model<IWebhook>('Webhook', WebhookSchema as any);
export default Webhook;
