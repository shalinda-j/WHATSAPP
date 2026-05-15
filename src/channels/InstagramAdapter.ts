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
 * Instagram Messaging adapter via the Meta Graph API (skeleton).
 *
 * Prereqs (operator/business, not code):
 *   1. Facebook Page connected to an Instagram Business/Creator account
 *   2. Meta Developer App with `instagram_manage_messages` permission
 *   3. App review approval from Meta (2-4 weeks)
 *   4. Page Access Token stored in ChannelConnection (encrypted)
 *
 * Inbound: Meta posts to POST /api/webhooks/instagram with event type
 *          'messages' or 'messaging_postbacks'.
 * Outbound: POST graph.facebook.com/v19.0/{ig-id}/messages
 *
 * The 24-hour messaging window applies — outside it, only message tags
 * (HUMAN_AGENT, CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE) are allowed.
 */
export class InstagramAdapter implements IChannelAdapter {
  readonly channel: Channel = 'instagram';
  private handlers: ChannelInboundHandler[] = [];

  async start(_tenantId: string): Promise<void> {
    // Webhook-based — nothing to "start" beyond ensuring the webhook URL
    // is registered with Meta. Validation happens on credentials save.
  }

  async stop(_tenantId: string): Promise<void> {
    // Optionally unsubscribe webhook for this page.
  }

  async send(_msg: OutboundMessage): Promise<ChannelSendResult> {
    // const conn = await ChannelConnection.findOne({
    //   tenantId: _msg.tenantId, channel: 'instagram'
    // });
    // const token = cryptoService.decrypt(conn.credentials.accessToken);
    // POST https://graph.facebook.com/v19.0/{IG_USER_ID}/messages
    //   { recipient: { id: _msg.recipient }, message: { text: _msg.text } }
    return {
      ok: false,
      error: 'InstagramAdapter.send not implemented (skeleton)',
    };
  }

  async status(_tenantId: string): Promise<ChannelConnectionStatus> {
    return {
      connected: false,
      detail: 'InstagramAdapter not implemented',
      lastCheckedAt: new Date(),
    };
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.handlers.push(handler);
  }

  /** Called by /api/webhooks/instagram POST handler. */
  async ingestWebhook(tenantId: string, payload: any): Promise<void> {
    const entries = payload?.entry ?? [];
    for (const entry of entries) {
      for (const event of entry?.messaging ?? []) {
        const inbound: InboundMessage = {
          channel: this.channel,
          tenantId,
          externalUserId: String(event?.sender?.id ?? ''),
          externalThreadId: String(event?.recipient?.id ?? ''),
          text: event?.message?.text,
          receivedAt: new Date(),
          raw: event,
        };
        for (const h of this.handlers) await h(inbound);
      }
    }
  }
}
