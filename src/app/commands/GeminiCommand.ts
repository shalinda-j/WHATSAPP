import { BaseCommand } from '../utils/BaseCommand';
import { proto } from '@whiskeysockets/baileys';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import { sendMessage } from '../../services/whatsapp';
import { SecurityService } from '../../services/SecurityService';

/**
 * AI Chat Command - Chat with AI with conversation memory (Load Balanced)
 */
export class GeminiCommand extends BaseCommand {
  name = 'ai';
  description = 'Chat with AI (has conversation memory)';
  aliases = ['glm', 'chat', 'ask', 'gpt'];

  async execute(
    message: proto.IWebMessageInfo,
    args: string[],
    sessionId: string,
  ): Promise<void> {
    const jid = message.key?.remoteJid;
    if (!jid) return;

    const text = args.join(' ').trim();

    try {
      await this.sendTyping(message, sessionId);
    } catch (e) {
      // Continue even if typing fails
    }

    // Handle clear command
    if (args[0]?.toLowerCase() === 'clear') {
      await aiLoadBalancer.clearConversation(jid);
      await sendMessage(
        jid,
        '🧹 Conversation history cleared! Starting fresh.',
        sessionId,
      );
      return;
    }

    if (args.length === 0) {
      await sendMessage(
        jid,
        '🤖 *Jayalath AI Assistant*\n\n' +
          '📖 *Usage:*\n' +
          '• `!ai <your question>` - Ask anything\n' +
          '• `!ai clear` - Clear conversation history\n\n' +
          '💡 *Example:* `!ai What is the capital of Sri Lanka?`',
        sessionId,
      );
      return;
    }

    const question = args.join(' ');

    // 1. Security Check (Defense in Depth)
    if (!SecurityService.isSafe(question)) {
      await sendMessage(
        jid,
        '🛡️ *Security Alert:* Your message contains unsafe content or restricted keywords.',
        sessionId,
      );
      return;
    }

    // 2. Delimiter Strategy (Input Isolation)
    // We wrap the user's input so the AI knows strictly what is "user content" vs "system instructions"
    const safePrompt = `<user_query>${question}</user_query>`;

    try {
      const response = await aiLoadBalancer.sendMessage(jid, safePrompt);

      await sendMessage(jid, `🤖 ${response}`, sessionId);
    } catch (error: any) {
      console.error('Gemini command error:', error);
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        await sendMessage(
          jid,
          '⚠️ API quota exceeded. Please try again in a minute.',
          sessionId,
        );
      } else {
        await sendMessage(
          jid,
          '⚠️ Failed to get AI response. Please try again later.',
          sessionId,
        );
      }
    }
  }
}
