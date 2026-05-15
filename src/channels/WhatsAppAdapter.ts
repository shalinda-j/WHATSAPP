import { Channel } from '../types/agent';
import { IChannelAdapter } from './IChannelAdapter';
import {
  ChannelConnectionStatus,
  ChannelInboundHandler,
  ChannelSendResult,
  OutboundMessage,
} from './types';

/**
 * Thin adapter that wraps the existing WhatsAppSessionManager
 * (src/services/whatsapp.ts) so it satisfies IChannelAdapter without
 * disrupting the legacy flow. Phase 1 implementation will:
 *   - move WhatsAppSessionManager.onMessage hook wiring here
 *   - normalise Baileys IWebMessageInfo to InboundMessage
 *   - replace direct sendMessage(jid, text, sessionId) calls with
 *     channelRouter.send({ channel: 'whatsapp', ... })
 */
export class WhatsAppAdapter implements IChannelAdapter {
  readonly channel: Channel = 'whatsapp';
  private handlers: ChannelInboundHandler[] = [];

  async start(_tenantId: string): Promise<void> {
    // No-op: existing WhatsAppSessionManager already boots from src/index.ts.
    // When the refactor lands, this becomes:
    //   await whatsappSessionManager.startTenantSessions(_tenantId);
  }

  async stop(_tenantId: string): Promise<void> {
    // Phase 1: whatsappSessionManager.stopTenantSessions(_tenantId)
  }

  async send(msg: OutboundMessage): Promise<ChannelSendResult> {
    // Phase 1: delegate to existing sendMessage(jid, text, sessionId)
    // For now this is a placeholder so callers can switch over incrementally.
    return {
      ok: false,
      error:
        'WhatsAppAdapter.send not yet wired — use legacy sendMessage() in src/services/whatsapp.ts',
    };
  }

  async status(_tenantId: string): Promise<ChannelConnectionStatus> {
    return {
      connected: false,
      detail: 'WhatsAppAdapter status probe not implemented',
      lastCheckedAt: new Date(),
    };
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.handlers.push(handler);
  }
}
