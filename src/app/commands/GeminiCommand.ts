import { BaseCommand } from '../utils/BaseCommand';
import type { Message } from 'whatsapp-web.js';
import { sendMessageWithMemory, clearConversation } from '../../services/gemini';
import { client } from '../../services/whatsapp';

/**
 * AI Chat Command - Chat with Gemini AI with conversation memory
 */
export class GeminiCommand extends BaseCommand {
    name = 'ai';
    description = 'Chat with Gemini AI (has conversation memory)';
    aliases = ['gemini', 'chat', 'ask', 'gpt'];

    async execute(message: Message, args: string[]): Promise<void> {
        try {
            await this.sendTyping(message);
        } catch (e) {
            // Continue even if typing fails
        }

        // Handle clear command
        if (args[0]?.toLowerCase() === 'clear') {
            const contact = await message.getContact();
            clearConversation(contact.id._serialized);
            await client.sendMessage(message.from, '🧹 Conversation history cleared! Starting fresh.');
            return;
        }

        if (args.length === 0) {
            await client.sendMessage(message.from,
                '🤖 *Gemini AI Assistant*\n\n' +
                '📖 *Usage:*\n' +
                '• `!ai <your question>` - Ask anything\n' +
                '• `!ai clear` - Clear conversation history\n\n' +
                '💡 *Example:* `!ai What is the capital of Sri Lanka?`'
            );
            return;
        }

        const question = args.join(' ');

        try {
            const contact = await message.getContact();
            const response = await sendMessageWithMemory(contact.id._serialized, question);

            await client.sendMessage(message.from, `🤖 ${response}`);
        } catch (error: any) {
            console.error('Gemini command error:', error);
            if (error.message?.includes('429') || error.message?.includes('quota')) {
                await client.sendMessage(message.from, '⚠️ API quota exceeded. Please try again in a minute.');
            } else {
                await client.sendMessage(message.from, '⚠️ Failed to get AI response. Please try again later.');
            }
        }
    }
}
