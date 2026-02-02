import { getSocket, sendMessage } from '../../services/whatsapp';
import { BaseCommand } from '../utils/BaseCommand';
import { proto } from '@whiskeysockets/baileys';

/**
 * Command to view a user's profile picture
 */
export class ProfileCommand extends BaseCommand {
  name = 'perfil';
  description = 'Shows the profile picture of a mentioned user';
  aliases = ['foto', 'avatar', 'pic'];

  async execute(message: proto.IWebMessageInfo, args: string[], sessionId: string): Promise<void> {
    const jid = message.key.remoteJid;
    if (!jid) return;

    await this.sendTyping(message, sessionId);

    // Validate if it's a group
    const isGroup = await this.requireGroup(message, sessionId);
    if (!isGroup) return;

    // Get mentioned contact
    // In Baileys, mentions are in message.message.extendedTextMessage.contextInfo.mentionedJid
    const mentions = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const contactJid = mentions[0];

    if (!contactJid) {
      await this.reply(message,
        '⚠️ Please mention a user.\n\n📖 *Usage:* !perfil @user',
        sessionId,
      );
      return;
    }

    await this.reply(message, '🔍 Searching for profile picture...', sessionId);

    try {
      const sock = getSocket(sessionId);
      if (!sock) {
        await this.reply(message, '⚠️ Connection error.', sessionId);
        return;
      }

      const uri = await sock.profilePictureUrl(contactJid, 'image').catch(() => null);

      if (!uri) {
        await this.reply(message, '⚠️ This user does not have a profile picture.', sessionId);
        return;
      }

      // Send image URL directly (Baileys can send from URL)
      await sock.sendMessage(jid, {
        image: { url: uri },
        caption: '📸 Profile Picture'
      });

    } catch (error) {
      console.error('Error fetching profile picture:', error);
      await this.reply(message, '⚠️ Unable to get the profile picture.', sessionId);
    }
  }
}
