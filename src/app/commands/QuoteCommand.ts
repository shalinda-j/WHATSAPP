import { getSocket } from '../../services/whatsapp';
import { company } from '../../config/integrantes.json';
import { BaseCommand } from '../utils/BaseCommand';
import type { proto } from '@whiskeysockets/baileys';

/**
 * Command to mention all group members
 */
export class QuoteCommand extends BaseCommand {
  name = 'mencionar';
  description = 'Mentions all group members (admins only)';
  aliases = ['everyone', 'all', 'todos'];

  async execute(
    message: proto.IWebMessageInfo,
    args: string[],
    sessionId: string,
  ): Promise<void> {
    const jid = message.key?.remoteJid;
    if (!jid) return;
    const text = args.join(' ');

    await this.sendTyping(message, sessionId);

    // Validate if it's a group
    const isGroup = await this.requireGroup(message, sessionId);
    if (!isGroup) return;

    // Provide a small delay or fetch user profile info for a dynamic reply
    const senderJid = message.key?.participant || message.key?.remoteJid;
    if (!senderJid) return;

    // Extract stats for permission check (using sender number)
    const senderNumber = senderJid.replace(/\D/g, ''); // Extract number only

    // Check permissions
    const allowPermissions = company.filter(
      ({ numero, admin }) => numero === senderNumber && admin,
    );

    if (!allowPermissions.length) {
      await this.reply(
        message,
        '⚠️ You do not have permission to use this command!',
        sessionId,
      );
      return;
    }

    try {
      const sock = getSocket(sessionId);
      if (!sock) return;

      // Fetch group metadata to get participants
      const groupMetadata = await sock.groupMetadata(jid);
      const participants = groupMetadata.participants;

      // Create mentions list
      const mentions = participants.map((p) => p.id);

      // Build message with @mentions
      const names = mentions.map((id) => `@${id.split('@')[0]}`).join(' ');

      // Prepend the admin's typed announcement (if any) above the mention list.
      // Previously only the bare @number list was sent and the actual message
      // (e.g. "!everyone Meeting at 5pm") was silently dropped.
      const body = text.trim() ? `${text.trim()}\n\n${names}` : names;

      // Send message with mentions
      await sock.sendMessage(jid, {
        text: body,
        mentions: mentions,
      });
    } catch (error) {
      console.error('Error fetching group members:', error);
      await this.reply(message, '⚠️ Failed to fetch group members.', sessionId);
    }
  }
}
