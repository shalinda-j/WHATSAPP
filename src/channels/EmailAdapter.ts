import { Channel } from '../types/agent';
import { IChannelAdapter } from './IChannelAdapter';
import {
  ChannelConnectionStatus,
  ChannelInboundHandler,
  ChannelSendResult,
  OutboundMessage,
} from './types';

/**
 * Email adapter (skeleton). Email is treated as a marketing channel here —
 * primarily outbound for campaigns, with optional inbound parsing for
 * reply tracking.
 *
 * Provider choice (per tenant, stored on ChannelConnection.credentials):
 *   - sendgrid   — recommended (transactional + marketing + inbound parse)
 *   - aws-ses    — cheapest at scale
 *   - mailgun    — good inbound parsing
 *   - smtp       — generic fallback
 *
 * Inbound parsing is OPTIONAL — many marketing flows only need outbound
 * + bounce/complaint webhooks.
 */
export class EmailAdapter implements IChannelAdapter {
  readonly channel: Channel = 'email';
  private handlers: ChannelInboundHandler[] = [];

  async start(_tenantId: string): Promise<void> {
    // Validate sender domain SPF/DKIM/DMARC records.
  }

  async stop(_tenantId: string): Promise<void> {
    // No-op.
  }

  async send(_msg: OutboundMessage): Promise<ChannelSendResult> {
    // const conn = await ChannelConnection.findOne({
    //   tenantId: _msg.tenantId, channel: 'email'
    // });
    // const apiKey = cryptoService.decrypt(conn.credentials.apiKey);
    // SendGrid: sgMail.send({ to, from, subject, text/html })
    return {
      ok: false,
      error: 'EmailAdapter.send not implemented (skeleton)',
    };
  }

  async status(_tenantId: string): Promise<ChannelConnectionStatus> {
    return {
      connected: false,
      detail: 'EmailAdapter not implemented',
      lastCheckedAt: new Date(),
    };
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.handlers.push(handler);
  }
}
