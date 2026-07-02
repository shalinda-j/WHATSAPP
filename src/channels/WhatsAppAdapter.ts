import { Channel } from '../types/agent';
import { IChannelAdapter } from './IChannelAdapter';
import {
  ChannelConnectionStatus,
  ChannelInboundHandler,
  ChannelSendResult,
  OutboundMessage,
} from './types';
import {
  sendMessageDetailed as whatsappSendMessageDetailed,
  getConnectionStatus,
} from '../services/whatsapp';

const DEFAULT_TENANT_SESSION = 'default';

/**
 * Live WhatsApp adapter — delegates outbound to the existing
 * WhatsAppSessionManager (src/services/whatsapp.ts). Inbound is
 * deliberately NOT wired here: the legacy onMessage chain in
 * src/index.ts already handles every inbound WhatsApp message with
 * the full booking/lead/form/command/AI flow. Registering a parallel
 * adapter handler would double-process every message.
 *
 * Once per-tenant Baileys sessions and a unified inbound pipe land,
 * inbound normalisation moves here and the legacy chain is retired.
 */
export class WhatsAppAdapter implements IChannelAdapter {
  readonly channel: Channel = 'whatsapp';
  private handlers: ChannelInboundHandler[] = [];

  async start(_tenantId: string): Promise<void> {
    // Outbound-only for now; see class doc-comment.
  }

  async stop(_tenantId: string): Promise<void> {
    // Legacy session manager owns its own lifecycle.
  }

  async send(msg: OutboundMessage): Promise<ChannelSendResult> {
    if (!msg.text) {
      return { ok: false, error: 'WhatsApp adapter requires text body' };
    }
    try {
      const sessionId =
        (msg.metadata?.sessionId as string) ?? DEFAULT_TENANT_SESSION;
      const { delivered, queued } = await whatsappSendMessageDetailed(
        msg.recipient,
        msg.text,
        sessionId,
      );
      // A queued message WILL be delivered by the Humanizer queue — report it
      // as a success (with the queued flag) so the campaign sender doesn't mark
      // the execution failed and re-send it (duplicate) on the next relaunch.
      if (delivered) return { ok: true };
      if (queued) return { ok: true, queued: true };
      return { ok: false, error: 'Send returned false' };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'WhatsApp send threw' };
    }
  }

  async status(_tenantId: string): Promise<ChannelConnectionStatus> {
    try {
      const s = await getConnectionStatus();
      return {
        connected: s?.status === 'connected',
        detail: `WhatsApp status=${s?.status ?? 'unknown'}, activeSessions=${
          s?.activeSessions ?? 0
        }`,
        lastCheckedAt: new Date(),
      };
    } catch (err: any) {
      return {
        connected: false,
        detail: err?.message ?? 'status probe failed',
        lastCheckedAt: new Date(),
      };
    }
  }

  onInbound(handler: ChannelInboundHandler): void {
    // Stored for future use when inbound normalisation moves here.
    this.handlers.push(handler);
  }
}
