import { channelRouter } from './ChannelRouter';
import { WhatsAppAdapter } from './WhatsAppAdapter';
import { TelegramAdapter } from './TelegramAdapter';
import { InstagramAdapter } from './InstagramAdapter';
import { FacebookMessengerAdapter } from './FacebookMessengerAdapter';
import { EmailAdapter } from './EmailAdapter';

let registered = false;

/**
 * Boot all channel adapters. Idempotent — safe to call multiple times.
 * Adapters are registered but NOT started for any tenant yet; per-tenant
 * start() is the caller's responsibility (typically TenantService.start()).
 */
export function registerCoreChannels(): void {
  if (registered) return;
  channelRouter.register(new WhatsAppAdapter());
  channelRouter.register(new TelegramAdapter());
  channelRouter.register(new InstagramAdapter());
  channelRouter.register(new FacebookMessengerAdapter());
  channelRouter.register(new EmailAdapter());
  registered = true;
  console.log(`📡 Registered channels: ${channelRouter.list().join(', ')}`);
}

export { channelRouter } from './ChannelRouter';
export * from './types';
export type { IChannelAdapter } from './IChannelAdapter';
