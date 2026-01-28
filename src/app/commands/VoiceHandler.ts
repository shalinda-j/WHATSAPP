import type { Message } from 'whatsapp-web.js';
import { transcribeAudio } from '../../services/zhipu';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import { client } from '../../services/whatsapp';

/**
 * Voice Message Handler
 * Handles voice messages (PTT - Push To Talk) and processes them with AI
 */
export class VoiceHandler {
    /**
     * Check if a message is a voice message
     */
    static isVoiceMessage(message: Message): boolean {
        return message.hasMedia && message.type === 'ptt';
    }

    /**
     * Handle incoming voice messages
     */
    static async handleVoiceMessage(message: Message): Promise<void> {
        if (!this.isVoiceMessage(message)) {
            return;
        }

        try {
            // Show typing indicator
            try {
                const chat = await message.getChat();
                await chat.sendStateTyping();
            } catch (e) {
                // Continue even if typing fails
            }

            // Download the voice message
            const media = await message.downloadMedia();

            if (!media || !media.data) {
                await client.sendMessage(message.from, '⚠️ Could not download voice message.');
                return;
            }

            console.log('🎤 Processing voice message...');
            console.log(`   MIME Type: ${media.mimetype}`);
            console.log(`   Data length: ${media.data.length} chars`);

            // Transcribe the audio using Zhipu (via existing service)
            // Note: using transcribeAudio from zhipu service as before
            const transcription = await transcribeAudio(media.data, media.mimetype);
            console.log(`   Transcription: ${transcription}`);

            // Check if transcription looks like a question or command
            const lowerText = transcription.toLowerCase().trim();
            const isQuestion = lowerText.includes('?') ||
                lowerText.startsWith('what') ||
                lowerText.startsWith('how') ||
                lowerText.startsWith('why') ||
                lowerText.startsWith('when') ||
                lowerText.startsWith('where') ||
                lowerText.startsWith('who') ||
                lowerText.startsWith('can') ||
                lowerText.startsWith('please') ||
                lowerText.startsWith('tell me');

            if (isQuestion && transcription.length > 10) {
                // If it's a question, get an AI response via Load Balancer
                const contact = await message.getContact();
                const aiResponse = await aiLoadBalancer.sendMessage(contact.id._serialized, transcription);

                await client.sendMessage(message.from,
                    `🎤 *Voice Transcription:*\n"${transcription}"\n\n` +
                    `🤖 *AI Response:*\n${aiResponse}`
                );
            } else {
                // Just return the transcription
                await client.sendMessage(message.from, `🎤 *Voice Transcription:*\n\n"${transcription}"`);
            }

        } catch (error: any) {
            console.error('Voice processing error:', error);
            if (error.message?.includes('429') || error.message?.includes('quota')) {
                await client.sendMessage(message.from, '⚠️ API quota exceeded. Please try again in a minute.');
            } else {
                await client.sendMessage(message.from, '⚠️ Could not process voice message. Please try again.');
            }
        }
    }
}
