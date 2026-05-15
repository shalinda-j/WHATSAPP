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
}

export interface ChannelConnectionStatus {
  connected: boolean;
  detail?: string;
  lastCheckedAt: Date;
}

export type ChannelInboundHandler = (msg: InboundMessage) => Promise<void>;
