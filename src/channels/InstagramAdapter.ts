import axios from 'axios';
import { Channel } from '../types/agent';
import { IChannelAdapter } from './IChannelAdapter';
import {
  ChannelConnectionStatus,
  ChannelInboundHandler,
  ChannelSendResult,
  InboundMessage,
  OutboundMessage,
} from './types';
import ChannelConnection from '../models/ChannelConnection';

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface InstagramConnectionState {
  accessToken: string;
  businessAccountId: string;
}

/**
 * Instagram Messaging adapter via the Meta Graph API.
 *
 * Live operationally once the operator completes Meta business
 * verification + app review (paperwork, ~2-3 weeks). Code path is
 * complete today: the moment Meta approves and the operator saves the
 * Page Access Token in /channels, inbound webhooks land at
 * /api/webhooks/instagram/:tenantSlug and outbound goes through the
 * Graph API call below.
 *
 * Credentials per tenant (ChannelConnection.credentials):
 *   accessToken         — Page Access Token with instagram_manage_messages
 *   businessAccountId   — IG Business/Creator account ID linked to the page
 *
 * Webhook path: handshake + ingest are wired in src/server/routes/webhooks.ts.
 */
export class InstagramAdapter implements IChannelAdapter {
  readonly channel: Channel = 'instagram';
  private handlers: ChannelInboundHandler[] = [];
  private clients = new Map<string, InstagramConnectionState>();

  async start(tenantId: string): Promise<void> {
    if (this.clients.has(tenantId)) return;
    const conn = await ChannelConnection.findOne({
      tenantId,
      channel: 'instagram',
      status: { $in: ['active', 'pending'] },
    });
    if (!conn) return;
    const accessToken = conn.credentials?.accessToken;
    const businessAccountId = conn.credentials?.businessAccountId;
    if (!accessToken || !businessAccountId) {
      await ChannelConnection.updateOne(
        { _id: conn._id },
        {
          $set: {
            status: 'failed',
            lastError: 'accessToken and businessAccountId are required',
          },
        },
      );
      return;
    }
    this.clients.set(tenantId, { accessToken, businessAccountId });
    await ChannelConnection.updateOne(
      { _id: conn._id },
      {
        $set: {
          status: 'active',
          lastConnectedAt: new Date(),
          lastError: '',
        },
      },
    );
  }

  async stop(tenantId: string): Promise<void> {
    this.clients.delete(tenantId);
  }

  async send(msg: OutboundMessage): Promise<ChannelSendResult> {
    if (!msg.text) {
      return { ok: false, error: 'Instagram adapter requires text body' };
    }
    const state = this.clients.get(msg.tenantId);
    if (!state) {
      return {
        ok: false,
        error: `No active Instagram session for tenant ${msg.tenantId}`,
      };
    }
    try {
      // Instagram Messenger API: POST /v19.0/{IG_USER_ID}/messages
      // Hard limit per Meta: 1000 chars in message.text.
      const res = await axios.post(
        `${GRAPH_BASE_URL}/${state.businessAccountId}/messages`,
        {
          recipient: { id: msg.recipient },
          message: { text: msg.text.slice(0, 1000) },
        },
        {
          params: { access_token: state.accessToken },
          timeout: 15_000,
        },
      );
      return {
        ok: true,
        externalMessageId: res.data?.message_id ?? res.data?.recipient_id,
      };
    } catch (err: any) {
      return {
        ok: false,
        error:
          err?.response?.data?.error?.message ??
          err?.response?.statusText ??
          err?.message ??
          'Instagram send threw',
      };
    }
  }

  async status(tenantId: string): Promise<ChannelConnectionStatus> {
    const state = this.clients.get(tenantId);
    return {
      connected: Boolean(state),
      detail: state
        ? `Active (businessAccountId=${state.businessAccountId})`
        : 'No active session — configure Instagram credentials in /channels',
      lastCheckedAt: new Date(),
    };
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Called by /api/webhooks/instagram/:tenantSlug POST handler.
   * Normalises Meta's batch payload into InboundMessage and fans out
   * to subscribed handlers (the orchestrator pipe in src/index.ts is
   * one of them).
   */
  async ingestWebhook(tenantId: string, payload: any): Promise<void> {
    const entries = payload?.entry ?? [];
    for (const entry of entries) {
      for (const event of entry?.messaging ?? []) {
        const inbound: InboundMessage = {
          channel: this.channel,
          tenantId,
          externalUserId: String(event?.sender?.id ?? ''),
          externalThreadId: String(event?.recipient?.id ?? ''),
          text:
            typeof event?.message?.text === 'string'
              ? event.message.text
              : undefined,
          receivedAt: event?.timestamp
            ? new Date(Number(event.timestamp))
            : new Date(),
          raw: event,
        };
        for (const h of this.handlers) {
          try {
            await h(inbound);
          } catch (err) {
            console.error('InstagramAdapter: inbound handler threw:', err);
          }
        }
      }
    }
  }
}
