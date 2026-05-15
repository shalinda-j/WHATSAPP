import { Channel } from '../types/agent';
import { IChannelAdapter } from './IChannelAdapter';
import {
  ChannelInboundHandler,
  ChannelSendResult,
  InboundMessage,
  OutboundMessage,
} from './types';

class ChannelRouter {
  private adapters = new Map<Channel, IChannelAdapter>();
  private inboundHandlers: ChannelInboundHandler[] = [];

  register(adapter: IChannelAdapter): void {
    if (this.adapters.has(adapter.channel)) {
      throw new Error(`Channel adapter already registered: ${adapter.channel}`);
    }
    this.adapters.set(adapter.channel, adapter);
    adapter.onInbound(async (msg) => this.dispatchInbound(msg));
  }

  get(channel: Channel): IChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

  list(): Channel[] {
    return Array.from(this.adapters.keys());
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.inboundHandlers.push(handler);
  }

  async send(msg: OutboundMessage): Promise<ChannelSendResult> {
    const adapter = this.adapters.get(msg.channel);
    if (!adapter) {
      return { ok: false, error: `No adapter for channel: ${msg.channel}` };
    }
    return adapter.send(msg);
  }

  async startAll(tenantId: string): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.start(tenantId);
      } catch (err) {
        console.error(
          `ChannelRouter: failed to start ${adapter.channel} for tenant ${tenantId}:`,
          err,
        );
      }
    }
  }

  private async dispatchInbound(msg: InboundMessage): Promise<void> {
    for (const handler of this.inboundHandlers) {
      try {
        await handler(msg);
      } catch (err) {
        console.error(
          `ChannelRouter: inbound handler threw for ${msg.channel}:`,
          err,
        );
      }
    }
  }
}

export const channelRouter = new ChannelRouter();
