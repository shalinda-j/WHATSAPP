import { BaseCommand } from '../utils/BaseCommand';
import { proto } from '@whiskeysockets/baileys';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import { sendMessage } from '../../services/whatsapp';

/**
 * AI Chat Command - Chat with AI with conversation memory (Load Balanced)
 */
export class GeminiCommand extends BaseCommand {
    name = 'ai';
    description = 'Chat with AI (has conversation memory)';
    aliases = ['glm', 'chat', 'ask', 'gpt'];

    async execute(message: proto.IWebMessageInfo, args: string[], sessionId: string): Promise<void> {
        const jid = message.key.remoteJid;
        if (!jid) return;

        try {
            await this.sendTyping(message, sessionId);
        } catch (e) {
            // Continue even if typing fails
        }

        // Handle clear command
        if (args[0]?.toLowerCase() === 'clear') {
            aiLoadBalancer.clearConversation(jid);
            await sendMessage(jid, '🧹 Conversation history cleared! Starting fresh.', sessionId);
            return;
        }

        if (args.length === 0) {
            await sendMessage(jid,
                '🤖 *Jayalath AI Assistant*\n\n' +
                '📖 *Usage:*\n' +
                '• `!ai <your question>` - Ask anything\n' +
                '• `!ai clear` - Clear conversation history\n\n' +
                '💡 *Example:* `!ai What is the capital of Sri Lanka?`',
                sessionId
            );
            return;
        }

        const question = args.join(' ');

        try {
            const response = await aiLoadBalancer.sendMessage(jid, question);

            await sendMessage(jid, `🤖 ${response}`, sessionId);
        } catch (error: any) {
            console.error('Gemini command error:', error);
            if (error.message?.includes('429') || error.message?.includes('quota')) {
                await sendMessage(jid, '⚠️ API quota exceeded. Please try again in a minute.', sessionId);
            } else {
                await sendMessage(jid, '⚠️ Failed to get AI response. Please try again later.', sessionId);
            }
        }
    }
}
