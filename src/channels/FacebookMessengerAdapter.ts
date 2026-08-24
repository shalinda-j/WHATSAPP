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
import { META_GRAPH_BASE_URL } from '../config/meta';

const GRAPH_BASE_URL = META_GRAPH_BASE_URL;

interface FacebookConnectionState {
  pageId: string;
  accessToken: string;
}

/**
 * Facebook Messenger adapter via the Meta Graph API.
 *
 * Same Meta dependency as Instagram (business verification + app
 * review). Targets a Facebook Page directly rather than the IG-linked
 * Business account.
 *
 * Credentials per tenant (ChannelConnection.credentials):
 *   pageId       — Facebook Page ID
 *   accessToken  — Page Access Token with pages_messaging permission
 *
 * Webhook path: handshake + ingest are wired in src/server/routes/webhooks.ts.
 */
export class FacebookMessengerAdapter implements IChannelAdapter {
  readonly channel: Channel = 'facebook';
  private handlers: ChannelInboundHandler[] = [];
  private clients = new Map<string, FacebookConnectionState>();

  async start(tenantId: string): Promise<void> {
    if (this.clients.has(tenantId)) return;
    const conn = await ChannelConnection.findOne({
      tenantId,
      channel: 'facebook',
      status: { $in: ['active', 'pending'] },
    });
    if (!conn) return;
    const accessToken = conn.credentials?.accessToken;
    const pageId = conn.credentials?.pageId;
    if (!accessToken || !pageId) {
      await ChannelConnection.updateOne(
        { _id: conn._id },
        {
          $set: {
            status: 'failed',
            lastError: 'accessToken and pageId are required',
          },
        },
      );
      return;
    }
    this.clients.set(tenantId, { pageId, accessToken });
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
      return { ok: false, error: 'Facebook adapter requires text body' };
    }
    const state = this.clients.get(msg.tenantId);
    if (!state) {
      return {
        ok: false,
        error: `No active Facebook session for tenant ${msg.tenantId}`,
      };
    }
    try {
      // Messenger Send API: POST /{version}/{PAGE_ID}/messages
      // 2000-char hard cap on text per Meta docs.
      const res = await axios.post(
        `${GRAPH_BASE_URL}/${state.pageId}/messages`,
        {
          recipient: { id: msg.recipient },
          message: { text: msg.text.slice(0, 2000) },
          messaging_type: 'RESPONSE',
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
          'Facebook send threw',
      };
    }
  }

  async status(tenantId: string): Promise<ChannelConnectionStatus> {
    const state = this.clients.get(tenantId);
    return {
      connected: Boolean(state),
      detail: state
        ? `Active (pageId=${state.pageId})`
        : 'No active session — configure Facebook credentials in /channels',
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
            console.error(
              'FacebookMessengerAdapter: inbound handler threw:',
              err,
            );
          }
        }
      }
    }
  }
}
