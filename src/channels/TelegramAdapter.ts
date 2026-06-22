import axios, { AxiosInstance } from 'axios';
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

const POLL_TIMEOUT_SEC = 25; // Telegram long-poll: server holds for up to this long
const POLL_RETRY_DELAY_MS = 5_000;

interface TelegramConnectionState {
  http: AxiosInstance;
  botToken: string;
  offset: number;
  /** ChannelConnection _id so we can persist the long-poll offset back. */
  connectionId: unknown;
  /** Last offset value flushed to the DB, to skip redundant writes. */
  persistedOffset: number;
  aborter: AbortController;
  loopPromise: Promise<void>;
}

/**
 * Telegram Bot API adapter using long-polling against api.telegram.org.
 * Chose long-poll over webhook to keep the deployment portable (no
 * incoming-public-URL dependency); the webhook path can be added later
 * via POST /api/webhooks/telegram if/when a tenant prefers it.
 *
 * Credentials per tenant live in the ChannelConnection collection:
 *   credentials.botToken — required, plaintext today; Phase 4 wires it
 *                          through CryptoService for at-rest encryption.
 */
export class TelegramAdapter implements IChannelAdapter {
  readonly channel: Channel = 'telegram';
  private handlers: ChannelInboundHandler[] = [];
  private clients = new Map<string, TelegramConnectionState>();

  async start(tenantId: string): Promise<void> {
    if (this.clients.has(tenantId)) return;

    const conn = await ChannelConnection.findOne({
      tenantId,
      channel: 'telegram',
      status: { $in: ['active', 'pending'] },
    });
    const botToken = conn?.credentials?.botToken;
    if (!conn || !botToken) {
      // No connection configured for this tenant; nothing to start.
      return;
    }

    const http = axios.create({
      baseURL: `https://api.telegram.org/bot${botToken}`,
      timeout: (POLL_TIMEOUT_SEC + 5) * 1000,
    });

    // Probe getMe so we mark the connection as active or surface a real error.
    try {
      const me = await http.get('/getMe');
      if (!me.data?.ok) {
        await ChannelConnection.updateOne(
          { _id: conn._id },
          {
            $set: {
              status: 'failed',
              lastError: 'Telegram getMe returned ok=false',
            },
          },
        );
        return;
      }
    } catch (err: any) {
      await ChannelConnection.updateOne(
        { _id: conn._id },
        {
          $set: {
            status: 'failed',
            lastError: `getMe failed: ${err?.message ?? 'unknown'}`,
          },
        },
      );
      return;
    }

    // Seed the in-memory offset from the persisted value so a crash/redeploy
    // does not re-deliver updates we already processed.
    const savedOffset = Number((conn.config as any)?.telegramOffset);
    const seededOffset = Number.isFinite(savedOffset) && savedOffset > 0 ? savedOffset : 0;

    const aborter = new AbortController();
    const state: TelegramConnectionState = {
      http,
      botToken,
      offset: seededOffset,
      connectionId: conn._id,
      persistedOffset: seededOffset,
      aborter,
      loopPromise: Promise.resolve(),
    };
    state.loopPromise = this.pollLoop(tenantId, state).catch((err) => {
      console.error(`TelegramAdapter: poll loop crashed for ${tenantId}:`, err);
    });
    this.clients.set(tenantId, state);

    await ChannelConnection.updateOne(
      { _id: conn._id },
      {
        $set: { status: 'active', lastConnectedAt: new Date(), lastError: '' },
      },
    );
  }

  async stop(tenantId: string): Promise<void> {
    const state = this.clients.get(tenantId);
    if (!state) return;
    state.aborter.abort();
    this.clients.delete(tenantId);
    try {
      await state.loopPromise;
    } catch {
      /* swallow — loop already logged */
    }
    // Flush the final offset so a clean shutdown does not lose progress.
    await this.persistOffset(state);
  }

  async send(msg: OutboundMessage): Promise<ChannelSendResult> {
    if (!msg.text) {
      return { ok: false, error: 'Telegram adapter requires text body' };
    }
    const state = this.clients.get(msg.tenantId);
    if (!state) {
      return {
        ok: false,
        error: `No active Telegram session for tenant ${msg.tenantId}`,
      };
    }
    try {
      const res = await state.http.post('/sendMessage', {
        chat_id: msg.recipient,
        text: msg.text.slice(0, 4096), // Telegram hard limit
      });
      if (!res.data?.ok) {
        return {
          ok: false,
          error: `Telegram sendMessage ok=false: ${JSON.stringify(res.data).slice(0, 200)}`,
        };
      }
      return {
        ok: true,
        externalMessageId: String(res.data.result?.message_id ?? ''),
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.response?.data?.description ?? err?.message ?? 'send threw',
      };
    }
  }

  async status(tenantId: string): Promise<ChannelConnectionStatus> {
    const state = this.clients.get(tenantId);
    return {
      connected: Boolean(state),
      detail: state
        ? `Active long-poll session; offset=${state.offset}`
        : 'No active session — connect a Telegram bot token in /channels',
      lastCheckedAt: new Date(),
    };
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.handlers.push(handler);
  }

  private async pollLoop(
    tenantId: string,
    state: TelegramConnectionState,
  ): Promise<void> {
    const signal = state.aborter.signal;
    while (!signal.aborted) {
      try {
        const res = await state.http.get('/getUpdates', {
          params: {
            offset: state.offset,
            timeout: POLL_TIMEOUT_SEC,
            // axios serializes a JS array as repeated query params, which the
            // Telegram API ignores; send the documented JSON-string form.
            allowed_updates: JSON.stringify(['message']),
          },
          signal,
        });
        if (!res.data?.ok) {
          await sleep(POLL_RETRY_DELAY_MS, signal);
          continue;
        }
        const updates = (res.data.result ?? []) as Array<any>;
        for (const update of updates) {
          state.offset = Math.max(state.offset, update.update_id + 1);
          await this.dispatchInbound(tenantId, update);
        }
        // Best-effort flush after each non-empty batch so a crash/redeploy
        // does not re-deliver updates we already handed off to handlers.
        if (updates.length > 0) {
          await this.persistOffset(state);
        }
      } catch (err: any) {
        if (signal.aborted) return;
        const code = err?.code;
        if (code === 'ERR_CANCELED' || code === 'ECONNABORTED') {
          // Timeout on long-poll is normal — just retry.
          continue;
        }
        console.error(
          `TelegramAdapter: getUpdates failed for tenant ${tenantId}:`,
          err?.response?.data ?? err?.message,
        );
        await sleep(POLL_RETRY_DELAY_MS, signal);
      }
    }
  }

  private async dispatchInbound(tenantId: string, update: any): Promise<void> {
    const message = update?.message;
    if (!message) return;
    const inbound: InboundMessage = {
      channel: this.channel,
      tenantId,
      externalUserId: String(message.from?.id ?? ''),
      externalThreadId: String(message.chat?.id ?? ''),
      text: typeof message.text === 'string' ? message.text : undefined,
      receivedAt: new Date((message.date ?? Date.now() / 1000) * 1000),
      raw: update,
    };
    for (const h of this.handlers) {
      try {
        await h(inbound);
      } catch (err) {
        console.error('TelegramAdapter: inbound handler threw:', err);
      }
    }
  }

  /**
   * Best-effort persistence of the long-poll offset to the ChannelConnection
   * config. Skips the write when nothing advanced, and never throws — a failed
   * flush just means at-most a small re-delivery window on the next restart.
   */
  private async persistOffset(state: TelegramConnectionState): Promise<void> {
    if (!state.connectionId) return;
    if (state.offset <= state.persistedOffset) return;
    const toPersist = state.offset;
    try {
      await ChannelConnection.updateOne(
        { _id: state.connectionId as any },
        { $set: { 'config.telegramOffset': toPersist } },
      );
      state.persistedOffset = toPersist;
    } catch (err: any) {
      console.error(
        'TelegramAdapter: failed to persist telegramOffset:',
        err?.message ?? err,
      );
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}
