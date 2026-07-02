import { Channel } from '../types/agent';

export interface InboundMessage {
  channel: Channel;
  tenantId: string;
  externalUserId: string;
  externalThreadId?: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: 'audio' | 'image' | 'video' | 'document';
  receivedAt: Date;
  raw?: unknown;
}

export interface OutboundMessage {
  channel: Channel;
  tenantId: string;
  recipient: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: 'audio' | 'image' | 'video' | 'document';
  metadata?: Record<string, unknown>;
}

export interface ChannelSendResult {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
  /**
   * True when the message was accepted for LATER delivery rather than sent
   * immediately (e.g. the WhatsApp Humanizer queued it due to a rate cap or a
   * momentary socket drop). Callers must treat this as a success — the message
   * WILL be delivered by the queue — and must NOT mark it failed / retry it,
   * which would double-send on the next campaign relaunch.
   */
  queued?: boolean;
}

export interface ChannelConnectionStatus {
  connected: boolean;
  detail?: string;
  lastCheckedAt: Date;
}

export type ChannelInboundHandler = (msg: InboundMessage) => Promise<void>;
