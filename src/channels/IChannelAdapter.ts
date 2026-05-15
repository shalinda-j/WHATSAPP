import { Channel } from '../types/agent';
import {
  ChannelConnectionStatus,
  ChannelInboundHandler,
  ChannelSendResult,
  OutboundMessage,
} from './types';

export interface IChannelAdapter {
  readonly channel: Channel;

  /**
   * Boots the adapter for a given tenant — opens sockets, registers webhooks,
   * starts polling, etc. Idempotent: calling twice for the same tenant must
   * be safe.
   */
  start(tenantId: string): Promise<void>;

  /**
   * Tears down the adapter for a tenant. Used on disconnect or tenant
   * suspension.
   */
  stop(tenantId: string): Promise<void>;

  /**
   * Outbound message send. The adapter is responsible for any
   * channel-specific formatting (e.g. WhatsApp 4096-char chunking,
   * Telegram parse_mode, Instagram tagged messages).
   */
  send(msg: OutboundMessage): Promise<ChannelSendResult>;

  /**
   * Channel-level health probe. Should be cheap — used by the channels
   * dashboard polling.
   */
  status(tenantId: string): Promise<ChannelConnectionStatus>;

  /**
   * Register a callback fired for every inbound message after the adapter
   * has normalised it into an InboundMessage. The ChannelRouter wires this
   * to the AgentOrchestrator.
   */
  onInbound(handler: ChannelInboundHandler): void;
}
