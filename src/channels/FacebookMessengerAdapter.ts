import { Channel } from '../types/agent';
import { IChannelAdapter } from './IChannelAdapter';
import {
  ChannelConnectionStatus,
  ChannelInboundHandler,
  ChannelSendResult,
  InboundMessage,
  OutboundMessage,
} from './types';

/**
 * Facebook Messenger adapter (skeleton). Uses the same Meta Graph API as
 * Instagram, but targets a Facebook Page directly.
 *
 * Prereqs:
 *   1. Facebook Page
 *   2. Meta Developer App with `pages_messaging` permission
 *   3. App review approval from Meta
 *   4. Page Access Token stored in ChannelConnection (encrypted)
 *
 * Inbound: POST /api/webhooks/facebook (shared verify token with Instagram)
 * Outbound: POST graph.facebook.com/v19.0/{PAGE_ID}/messages
 */
export class FacebookMessengerAdapter implements IChannelAdapter {
  readonly channel: Channel = 'facebook';
  private handlers: ChannelInboundHandler[] = [];

  async start(_tenantId: string): Promise<void> {
    // Webhook-driven; no boot work beyond credential validation.
  }

  async stop(_tenantId: string): Promise<void> {
    // No-op.
  }

  async send(_msg: OutboundMessage): Promise<ChannelSendResult> {
    // POST https://graph.facebook.com/v19.0/{PAGE_ID}/messages
    //   { recipient: { id: _msg.recipient }, message: { text: _msg.text } }
    return {
      ok: false,
      error: 'FacebookMessengerAdapter.send not implemented (skeleton)',
    };
  }

  async status(_tenantId: string): Promise<ChannelConnectionStatus> {
    return {
      connected: false,
      detail: 'FacebookMessengerAdapter not implemented',
      lastCheckedAt: new Date(),
    };
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.handlers.push(handler);
  }

  async ingestWebhook(tenantId: string, payload: any): Promise<void> {
    const entries = payload?.entry ?? [];
    for (const entry of entries) {
      for (const event of entry?.messaging ?? []) {
        const inbound: InboundMessage = {
          channel: this.channel,
          tenantId,
          externalUserId: String(event?.sender?.id ?? ''),
          externalThreadId: String(entry?.id ?? ''),
          text: event?.message?.text,
          receivedAt: new Date(),
          raw: event,
        };
        for (const h of this.handlers) await h(inbound);
      }
    }
  }
}
