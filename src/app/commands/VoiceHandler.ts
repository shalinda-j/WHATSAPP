import { proto } from '@whiskeysockets/baileys';
import { transcribeAudio } from '../../services/gemini';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import {
  sendMessage,
  downloadWhatsAppAudio,
  sendTyping,
} from '../../services/whatsapp';

/**
 * Voice Message Handler
 * Handles voice messages (PTT - Push To Talk) and processes them with AI
 */
export class VoiceHandler {
  /**
   * Check if a message is a voice message
   */
  static isVoiceMessage(message: proto.IWebMessageInfo): boolean {
    // In Baileys, audioMessage implies voice note if ptt is true, but generic check is usually enough
    const msg = message.message;
    return !!(msg?.audioMessage || msg?.listMessage || msg?.buttonsMessage);
    // Strict voice check:
    // return !!msg?.audioMessage?.ptt;
  }

  /**
   * Check if the message is from a group chat
   */
  static isGroup(message: proto.IWebMessageInfo): boolean {
    return message.key?.remoteJid?.endsWith('@g.us') || false;
  }

  /**
   * Handle incoming voice messages
   */
  static async handleVoiceMessage(
    _sock: any,
    message: proto.IWebMessageInfo,
    sessionId: string,
  ) {
    const msg = message.message?.audioMessage;
    if (!msg) return;

    // Only handle PTT (voice notes)
    if (!msg.ptt) {
      return;
    }

    const jid = message.key?.remoteJid;
    if (!jid) return;

    try {
      // Show typing indicator
      try {
        await sendTyping(jid, sessionId);
      } catch (e) {
        // Continue even if typing fails
      }

      // Download the voice message
      const buffer = await downloadWhatsAppAudio(message);

      if (!buffer) {
        await sendMessage(
          jid,
          '⚠️ Could not download voice message.',
          sessionId,
        );
        return;
      }

      console.log('🎤 Processing voice message...');
      // mimetype is essential
      const mimetype = msg.mimetype || 'audio/ogg; codecs=opus';
      console.log(`   MIME Type: ${mimetype}`);
      console.log(`   Data length: ${buffer.length} chars`);

      // Transcribe the audio using Zhipu (via existing service)
      const transcription = await transcribeAudio(
        buffer.toString('base64'),
        mimetype,
      );
      console.log(`   Transcription: ${transcription}`);

      // Get voice mode and agent status
      const { getVoiceMode, isVoiceAgentEnabled } = await import(
        '../../services/voice'
      );
      const voiceMode = await getVoiceMode();
      const isAgentEnabled = await isVoiceAgentEnabled();

      console.log(
        `   Voice Mode: ${voiceMode}, Agent Enabled: ${isAgentEnabled}`,
      );

      // If voice agent is disabled, just send transcription
      if (!isAgentEnabled) {
        await sendMessage(
          jid,
          `🎤 *Voice Transcription:*\n\n"${transcription}"\n\n_Voice AI is currently disabled._`,
          sessionId,
        );
        return;
      }

      // Check if transcription looks like a question or command
      const lowerText = transcription.toLowerCase().trim();
      const isQuestion =
        lowerText.includes('?') ||
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
        const aiResponse = await aiLoadBalancer.sendMessage(jid, transcription);

        // Determine response format based on mode
        const shouldSendText =
          voiceMode === 'text-only' || voiceMode === 'voice-and-text';
        const shouldSendVoice =
          voiceMode === 'voice-only' || voiceMode === 'voice-and-text';

        if (shouldSendText) {
          await sendMessage(
            jid,
            `🎤 *Voice Transcription:*\n"${transcription}"\n\n` +
              `🤖 *AI Response:*\n${aiResponse}`,
            sessionId,
          );
        }

        // Generate and send voice reply if mode allows
        if (shouldSendVoice) {
          try {
            const { generateSpeech } = await import('../../services/voice');
            const { sendVoiceMessage } = await import(
              '../../services/whatsapp'
            );

            const audioBuffer = await generateSpeech(aiResponse);
            await sendVoiceMessage(jid, audioBuffer, sessionId);
          } catch (ttsError) {
            console.error('TTS Error:', ttsError);
            // If voice fails and we didn't send text, send text as fallback
            if (!shouldSendText) {
              await sendMessage(
                jid,
                `🤖 *AI Response:*\n${aiResponse}\n\n_Voice synthesis failed._`,
                sessionId,
              );
            }
          }
        }
      } else {
        // Just return the transcription
        await sendMessage(
          jid,
          `🎤 *Voice Transcription:*\n\n"${transcription}"`,
          sessionId,
        );
      }
    } catch (error: any) {
      console.error('Voice processing error:', error);
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        await sendMessage(
          jid,
          '⚠️ API quota exceeded. Please try again in a minute.',
          sessionId,
        );
      } else {
        await sendMessage(
          jid,
          '⚠️ Could not process voice message. Please try again.',
          sessionId,
        );
      }
    }
  }
}
