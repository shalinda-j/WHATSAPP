import { BaseCommand } from '../utils/BaseCommand';
import { generateSinhalaResponse } from '../../services/gemini';
import { sendMessage } from '../../services/whatsapp';
import type { proto } from '@whiskeysockets/baileys';

/**
 * Sinhala AI Command - Chat with AI in Sinhala language
 */
export class SinhalaCommand extends BaseCommand {
  name = 'si';
  description = 'Chat with AI in Sinhala (සිංහල භාෂාවෙන් කතා කරන්න)';
  aliases = ['sinhala', 'සිංහල'];

  async execute(
    message: proto.IWebMessageInfo,
    args: string[],
    sessionId: string,
  ): Promise<void> {
    const jid = message.key?.remoteJid;
    if (!jid) return;
    const text = args.join(' ');

    try {
      await this.sendTyping(message, sessionId);
    } catch (e) {
      // Continue even if typing fails
    }

    if (args.length === 0) {
      await sendMessage(
        jid,
        '🇱🇰 *සිංහල AI සහායක*\n\n' +
          '📖 *භාවිතය:*\n' +
          '`!si <ඔබේ ප්‍රශ්නය>`\n\n' +
          '💡 *උදාහරණය:* `!si ශ්‍රී ලංකාවේ අගනුවර කුමක්ද?`',
        sessionId,
      );
      return;
    }

    const question = args.join(' ');

    try {
      const response = await generateSinhalaResponse(question);
      await sendMessage(jid, `🤖 ${response}`, sessionId);
    } catch (error: any) {
      console.error('Sinhala AI error:', error);
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        await sendMessage(
          jid,
          '⚠️ API quota එක ඉක්මවා ඇත. කරුණාකර විනාඩියකින් නැවත උත්සාහ කරන්න.',
          sessionId,
        );
      } else {
        await sendMessage(
          jid,
          '⚠️ දෝෂයක් සිදු විය. කරුණාකර නැවත උත්සාහ කරන්න.',
          sessionId,
        );
      }
    }
  }
}
