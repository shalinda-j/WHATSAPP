const WHATSAPP_STATUS_BROADCAST_JID = 'status@broadcast';

/**
 * Ignore WhatsApp Status broadcasts. The bot has no Status feature, and asking
 * Baileys to decrypt these messages can produce stale libsignal PreKey errors
 * after a rolling deployment without affecting direct or group chats.
 */
export function shouldIgnoreWhatsAppJid(jid: string): boolean {
  return jid === WHATSAPP_STATUS_BROADCAST_JID;
}
