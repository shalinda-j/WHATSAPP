import { BaseCommand } from '../utils/BaseCommand';
import type { Message } from 'whatsapp-web.js';
import { generateSinhalaResponse } from '../../services/gemini';
import { client } from '../../services/whatsapp';

/**
 * Sinhala AI Command - Chat with AI in Sinhala language
 */
export class SinhalaCommand extends BaseCommand {
    name = 'si';
    description = 'Chat with AI in Sinhala (සිංහල භාෂාවෙන් කතා කරන්න)';
    aliases = ['sinhala', 'සිංහල'];

    async execute(message: Message, args: string[]): Promise<void> {
        try {
            await this.sendTyping(message);
        } catch (e) {
            // Continue even if typing fails
        }

        if (args.length === 0) {
            await client.sendMessage(message.from,
                '🇱🇰 *සිංහල AI සහායක*\n\n' +
                '📖 *භාවිතය:*\n' +
                '`!si <ඔබේ ප්‍රශ්නය>`\n\n' +
                '💡 *උදාහරණය:* `!si ශ්‍රී ලංකාවේ අගනුවර කුමක්ද?`'
            );
            return;
        }

        const question = args.join(' ');

        try {
            const response = await generateSinhalaResponse(question);
            await client.sendMessage(message.from, `🤖 ${response}`);
        } catch (error: any) {
            console.error('Sinhala AI error:', error);
            if (error.message?.includes('429') || error.message?.includes('quota')) {
                await client.sendMessage(message.from, '⚠️ API quota එක ඉක්මවා ඇත. කරුණාකර විනාඩියකින් නැවත උත්සාහ කරන්න.');
            } else {
                await client.sendMessage(message.from, '⚠️ දෝෂයක් සිදු විය. කරුණාකර නැවත උත්සාහ කරන්න.');
            }
        }
    }
}
