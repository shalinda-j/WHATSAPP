import Webhook, { IWebhook, WebhookFormat } from '../models/Webhook';
import axios from 'axios';
import crypto from 'crypto';

export type OpsAlertLevel = 'info' | 'warn' | 'error' | 'critical';

export interface OpsAlertInput {
  level: OpsAlertLevel;
  title: string;
  body: string;
  /** Optional structured fields rendered as a key/value block. */
  fields?: Record<string, string | number | boolean>;
  /** Optional source link (e.g. dashboard URL) attached to Slack/Discord. */
  url?: string;
}

const LEVEL_EMOJI: Record<OpsAlertLevel, string> = {
  info: ':information_source:',
  warn: ':warning:',
  error: ':rotating_light:',
  critical: ':bangbang:',
};

const LEVEL_COLOR: Record<OpsAlertLevel, number> = {
  info: 0x3b82f6,
  warn: 0xf59e0b,
  error: 0xef4444,
  critical: 0x991b1b,
};

function fieldsToLines(
  fields?: Record<string, string | number | boolean>,
): string {
  if (!fields) return '';
  return Object.entries(fields)
    .map(([k, v]) => `• *${k}:* ${String(v)}`)
    .join('\n');
}

function buildPayload(format: WebhookFormat, alert: OpsAlertInput): unknown {
  if (format === 'slack') {
    const emoji = LEVEL_EMOJI[alert.level];
    const text = [
      `${emoji} *${alert.title}*`,
      alert.body,
      fieldsToLines(alert.fields),
      alert.url ? `<${alert.url}|open>` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return { text };
  }
  if (format === 'discord') {
    return {
      content: `${LEVEL_EMOJI[alert.level]} **${alert.title}**`,
      embeds: [
        {
          description: alert.body,
          color: LEVEL_COLOR[alert.level],
          url: alert.url,
          fields: alert.fields
            ? Object.entries(alert.fields).map(([name, value]) => ({
                name,
                value: String(value),
                inline: true,
              }))
            : undefined,
        },
      ],
    };
  }
  // Generic JSON envelope — same shape any custom listener can consume.
  return {
    event: 'ops.alert',
    timestamp: new Date().toISOString(),
    payload: {
      level: alert.level,
      title: alert.title,
      body: alert.body,
      fields: alert.fields,
      url: alert.url,
    },
  };
}

export class WebhookService {
  /**
   * Trigger webhooks for a specific event
   */
  public static async triggerWebhook(
    event: string,
    payload: any,
    webhook?: any,
  ) {
    try {
      // Find active webhooks subscribed to this event (or all events with *).
      // Exclude 'ops' category — those receive only ops alerts, not business events.
      const webhooks = await (Webhook as any).find({
        isActive: true,
        $and: [
          { $or: [{ events: event }, { events: '*' }] },
          {
            $or: [
              { category: { $ne: 'ops' } },
              { category: { $exists: false } },
            ],
          },
        ],
      });

      if (webhooks.length === 0) return;

      console.log(
        `🪝 Triggering ${webhooks.length} webhooks for event: ${event}`,
      );

      // Fire and forget (don't await completion to avoid blocking main thread)
      webhooks.forEach((webhook: any) =>
        this.sendPayload(webhook, event, payload),
      );
    } catch (error) {
      console.error('Error triggering webhooks:', error);
    }
  }

  /**
   * Broadcast an operations alert to every active webhook in the 'ops'
   * category. Each webhook's `format` decides the payload shape (Slack
   * incoming-webhook, Discord embed, or generic JSON). Failures are
   * logged per-target and never bubble up — ops alerts are observability,
   * not a control-flow dependency.
   */
  public static async triggerOpsAlert(alert: OpsAlertInput): Promise<void> {
    try {
      const webhooks = (await (Webhook as any).find({
        isActive: true,
        category: 'ops',
      })) as IWebhook[];

      if (webhooks.length === 0) return;

      console.log(
        `🚨 Ops alert (${alert.level}): "${alert.title}" → ${webhooks.length} webhook(s)`,
      );

      await Promise.allSettled(
        webhooks.map((wh) => this.sendOpsPayload(wh, alert)),
      );
    } catch (error) {
      console.error('triggerOpsAlert failed:', error);
    }
  }

  private static async sendOpsPayload(
    webhook: IWebhook,
    alert: OpsAlertInput,
  ): Promise<void> {
    try {
      const format: WebhookFormat = webhook.format ?? 'generic';
      const data = buildPayload(format, alert);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Bot-Ops/1.0',
        'X-Ops-Level': alert.level,
      };
      // Slack + Discord incoming webhooks are unauthenticated by URL secret;
      // for the generic format we keep HMAC signing so custom listeners can
      // verify origin the same way they do for business webhooks.
      if (format === 'generic' && webhook.secret) {
        const signature = crypto
          .createHmac('sha256', webhook.secret)
          .update(JSON.stringify(data))
          .digest('hex');
        headers['X-Hub-Signature'] = `sha256=${signature}`;
      }
      await axios.post(webhook.url, data, { headers, timeout: 5000 });
    } catch (error: any) {
      console.error(
        `   ❌ Ops webhook failed for ${webhook.name}:`,
        error?.message ?? error,
      );
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

export { buildPayload as _buildOpsPayload };
