import axios, { AxiosInstance } from 'axios';
import { Channel } from '../types/agent';
import { IChannelAdapter } from './IChannelAdapter';
import {
  ChannelConnectionStatus,
  ChannelInboundHandler,
  ChannelSendResult,
  OutboundMessage,
} from './types';
import ChannelConnection from '../models/ChannelConnection';

interface EmailConnectionState {
  http: AxiosInstance;
  provider: 'sendgrid';
  fromAddress: string;
  fromName?: string;
}

/**
 * Email adapter — SendGrid v3 REST API via axios (no new npm dep).
 * The provider key on ChannelConnection.credentials.provider is forward-
 * compatible with future SES / SMTP backends; today only 'sendgrid' is
 * implemented because it's the lowest-friction option for marketing
 * teams that already have a SendGrid account.
 *
 * Credentials per tenant (ChannelConnection.credentials):
 *   provider     — 'sendgrid' (default)
 *   apiKey       — SendGrid API key with 'mail.send' scope
 *   fromAddress  — verified sender address
 *   fromName     — optional sender display name
 *
 * Inbound parsing (delivery + reply webhooks) is NOT implemented here;
 * SendGrid's Inbound Parse needs a public webhook URL which is outside
 * the deployment shape this branch supports. The marketing pipeline
 * works end-to-end without it (outbound campaigns + tracked
 * externalMessageId for status correlation).
 */
export class EmailAdapter implements IChannelAdapter {
  readonly channel: Channel = 'email';
  private handlers: ChannelInboundHandler[] = [];
  private clients = new Map<string, EmailConnectionState>();

  async start(tenantId: string): Promise<void> {
    if (this.clients.has(tenantId)) return;

    const conn = await ChannelConnection.findOne({
      tenantId,
      channel: 'email',
      status: { $in: ['active', 'pending'] },
    });
    if (!conn) return;

    const provider = (conn.credentials?.provider as string) ?? 'sendgrid';
    const apiKey = conn.credentials?.apiKey;
    const fromAddress = conn.credentials?.fromAddress;
    if (!apiKey || !fromAddress) {
      await ChannelConnection.updateOne(
        { _id: conn._id },
        {
          $set: {
            status: 'failed',
            lastError: 'apiKey and fromAddress are required',
          },
        },
      );
      return;
    }
    if (provider !== 'sendgrid') {
      await ChannelConnection.updateOne(
        { _id: conn._id },
        {
          $set: {
            status: 'failed',
            lastError: `provider '${provider}' not implemented yet; use 'sendgrid'`,
          },
        },
      );
      return;
    }

    const http = axios.create({
      baseURL: 'https://api.sendgrid.com/v3',
      timeout: 15_000,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    this.clients.set(tenantId, {
      http,
      provider: 'sendgrid',
      fromAddress,
      fromName: conn.credentials?.fromName,
    });

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
      return { ok: false, error: 'Email adapter requires text body' };
    }
    const state = this.clients.get(msg.tenantId);
    if (!state) {
      return {
        ok: false,
        error: `No active Email session for tenant ${msg.tenantId}`,
      };
    }
    const subject =
      (msg.metadata?.subject as string) ?? 'Message from your provider';
    try {
      const res = await state.http.post('/mail/send', {
        personalizations: [{ to: [{ email: msg.recipient }] }],
        from: state.fromName
          ? { email: state.fromAddress, name: state.fromName }
          : { email: state.fromAddress },
        subject,
        content: [{ type: 'text/plain', value: msg.text }],
      });
      // SendGrid responds 202 with X-Message-Id header on success.
      if (res.status !== 202 && res.status !== 200) {
        return {
          ok: false,
          error: `SendGrid returned HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`,
        };
      }
      return {
        ok: true,
        externalMessageId:
          (res.headers['x-message-id'] as string | undefined) ?? undefined,
      };
    } catch (err: any) {
      return {
        ok: false,
        error:
          err?.response?.data?.errors?.[0]?.message ??
          err?.response?.statusText ??
          err?.message ??
          'SendGrid send threw',
      };
    }
  }

  async status(tenantId: string): Promise<ChannelConnectionStatus> {
    const state = this.clients.get(tenantId);
    return {
      connected: Boolean(state),
      detail: state
        ? `Active (provider=${state.provider}, from=${state.fromAddress})`
        : 'No active session — configure SendGrid credentials in /channels',
      lastCheckedAt: new Date(),
    };
  }

  onInbound(handler: ChannelInboundHandler): void {
    // Inbound webhook ingestion is not implemented (see class doc).
    this.handlers.push(handler);
  }
}
