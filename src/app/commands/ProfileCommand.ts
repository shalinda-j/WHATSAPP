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

  async execute(
    message: proto.IWebMessageInfo,
    args: string[],
    _sessionId: string,
  ): Promise<void> {
    const senderJid = message.key?.participant || message.key?.remoteJid;
    const jid = message.key?.remoteJid;
    if (!jid || !senderJid) return;
    // Note: react requires sock but BaseCommand doesn't provide it here, so using sendReply or just ignoring react.
    await this.sendTyping(message, _sessionId);

    // Validate if it's a group
    const isGroup = await this.requireGroup(message, _sessionId);
    if (!isGroup) return;

    // Get mentioned contact
    // In Baileys, mentions are in message.message.extendedTextMessage.contextInfo.mentionedJid
    const mentions =
      message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const contactJid = mentions[0];

    if (!contactJid) {
      await this.reply(
        message,
        '⚠️ Please mention a user.\n\n📖 *Usage:* !perfil @user',
        _sessionId,
      );
      return;
    }

    await this.reply(
      message,
      '🔍 Searching for profile picture...',
      _sessionId,
    );

    try {
      const sock = getSocket(_sessionId);
      if (!sock) {
        await this.reply(
          message,
          '⚠️ Failed to fetch group profile!',
          _sessionId,
        );
        return;
      }

      const uri = await sock
        .profilePictureUrl(contactJid, 'image')
        .catch(() => null);

      if (!uri) {
        await this.reply(
          message,
          '⚠️ This user does not have a profile picture.',
          _sessionId,
        );
        return;
      }

      // Send image URL directly (Baileys can send from URL)
      await sock.sendMessage(jid, {
        image: { url: uri },
        caption: '📸 Profile Picture',
      });
    } catch (error) {
      console.error('Error fetching profile picture:', error);
      await this.reply(
        message,
        '⚠️ Unable to get the profile picture.',
        _sessionId,
      );
    }
  }
}
