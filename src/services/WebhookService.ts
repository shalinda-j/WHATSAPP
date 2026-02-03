import Webhook, { IWebhook } from '../models/Webhook';
import axios from 'axios';
import crypto from 'crypto';

export class WebhookService {
    /**
     * Trigger webhooks for a specific event
     */
    static async triggerWebhook(event: string, payload: any) {
        try {
            // Find active webhooks subscribed to this event (or all events with *)
            const webhooks = await (Webhook as any).find({
                isActive: true,
                $or: [{ events: event }, { events: '*' }],
            });

            if (webhooks.length === 0) return;

            console.log(`🪝 Triggering ${webhooks.length} webhooks for event: ${event}`);

            // Fire and forget (don't await completion to avoid blocking main thread)
            webhooks.forEach((webhook) => this.sendPayload(webhook, event, payload));
        } catch (error) {
            console.error('Error triggering webhooks:', error);
        }
    }

    /**
     * Send payload to a single webhook
     */
    private static async sendPayload(
        webhook: IWebhook,
        event: string,
        payload: any,
    ) {
        try {
            const data = {
                event,
                timestamp: new Date().toISOString(),
                payload,
            };

            const headers: any = {
                'Content-Type': 'application/json',
                'User-Agent': 'Jayalath-Bot/1.0',
                'X-Webhook-Event': event,
            };

            // Calculate Signature if secret exists
            if (webhook.secret) {
                const signature = crypto
                    .createHmac('sha256', webhook.secret)
                    .update(JSON.stringify(data))
                    .digest('hex');
                headers['X-Hub-Signature'] = `sha256=${signature}`;
            }

            await axios.post(webhook.url, data, { headers, timeout: 5000 });
            console.log(`   ✅ Webhook sent to ${webhook.name} (${webhook.url})`);
        } catch (error: any) {
            console.error(
                `   ❌ Webhook failed for ${webhook.name}:`,
                error.message || error,
            );
        }
    }
}
