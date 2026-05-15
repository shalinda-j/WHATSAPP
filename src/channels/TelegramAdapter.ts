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
 * Telegram Bot API adapter (skeleton). Production implementation will use
 * either:
 *   - long polling via @telegraf/telegraf (simpler for self-hosted)
 *   - webhook mode with setWebhook + POST /api/webhooks/telegram (needed for
 *     serverless / DigitalOcean App Platform)
 *
 * Credentials per tenant live in the ChannelConnection collection
 * (botToken stored encrypted). One Telegram bot can serve only one tenant
 * unless we proxy via username routing in the bot link.
 */
export class TelegramAdapter implements IChannelAdapter {
  readonly channel: Channel = 'telegram' as Channel;
  private handlers: ChannelInboundHandler[] = [];
  private clients = new Map<string, unknown>(); // tenantId -> Telegraf instance

  async start(_tenantId: string): Promise<void> {
    // 1. Load ChannelConnection row for (tenantId, channel='telegram')
    // 2. Decrypt botToken with CryptoService
    // 3. const bot = new Telegraf(botToken)
    // 4. bot.on('message', this.normaliseAndDispatch)
    // 5. bot.launch() OR set webhook URL
    // 6. this.clients.set(tenantId, bot)
  }

  async stop(_tenantId: string): Promise<void> {
    // const bot = this.clients.get(tenantId); bot?.stop();
    // this.clients.delete(tenantId);
  }

  async send(_msg: OutboundMessage): Promise<ChannelSendResult> {
    // const bot = this.clients.get(_msg.tenantId);
    // const result = await bot.telegram.sendMessage(_msg.recipient, _msg.text);
    // return { ok: true, externalMessageId: String(result.message_id) };
    return {
      ok: false,
      error: 'TelegramAdapter.send not implemented (skeleton)',
    };
  }

  async status(_tenantId: string): Promise<ChannelConnectionStatus> {
    return {
      connected: this.clients.has(_tenantId),
      lastCheckedAt: new Date(),
    };
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.handlers.push(handler);
  }

  // Reserved for Phase 1 wire-up — invoked once telegraf listeners land.
  private async _normaliseAndDispatch(
    tenantId: string,
    rawUpdate: any,
  ): Promise<void> {
    const inbound: InboundMessage = {
      channel: this.channel,
      tenantId,
      externalUserId: String(rawUpdate?.from?.id ?? ''),
      externalThreadId: String(rawUpdate?.chat?.id ?? ''),
      text: rawUpdate?.text,
      receivedAt: new Date(),
      raw: rawUpdate,
    };
    for (const h of this.handlers) await h(inbound);
  }
}
