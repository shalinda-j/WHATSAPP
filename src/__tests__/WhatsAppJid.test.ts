import { shouldIgnoreWhatsAppJid } from '../utils/whatsappJid';

describe('shouldIgnoreWhatsAppJid', () => {
  it('ignores WhatsApp Status broadcasts that the bot does not process', () => {
    expect(shouldIgnoreWhatsAppJid('status@broadcast')).toBe(true);
  });

  it('keeps direct and group chats enabled', () => {
    expect(shouldIgnoreWhatsAppJid('94770000000@s.whatsapp.net')).toBe(false);
    expect(shouldIgnoreWhatsAppJid('123456789@g.us')).toBe(false);
  });
});
