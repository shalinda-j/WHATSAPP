import { proto } from '@whiskeysockets/baileys';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import {
  sendMessage,
  downloadWhatsAppAudio,
  sendTyping,
  sendVoiceMessage,
} from '../../services/whatsapp';
import {
  transcribeAudioWithLanguage,
  generateSpeech,
  getVoiceMode,
  isVoiceAgentEnabled,
} from '../../services/voice';

/**
 * Voice Message Handler
 * Handles voice notes (PTT) sent to WhatsApp and processes them with AI.
 */
export class VoiceHandler {
  /**
   * Check if a message is a voice note (PTT only — excludes audio files, lists, buttons).
   */
  static isVoiceMessage(message: proto.IWebMessageInfo): boolean {
    const msg = message.message;
    return !!msg?.audioMessage?.ptt;
  }

  /**
   * Check if the message is from a group chat
   */
  static isGroup(message: proto.IWebMessageInfo): boolean {
    return message.key?.remoteJid?.endsWith('@g.us') || false;
  }

  /**
   * Handle an incoming WhatsApp voice note end-to-end:
   *  1. Download audio
   *  2. Transcribe (provider chain: OpenAI Whisper → Gemini, per VoiceConfig)
   *  3. Get AI response via load balancer
   *  4. Send back text + voice note (per mode setting)
   */
  static async handleVoiceMessage(
    _sock: any,
    message: proto.IWebMessageInfo,
    sessionId: string,
  ) {
    // Only handle genuine PTT voice notes
    const audioMsg = message.message?.audioMessage;
    if (!audioMsg?.ptt) return;

    const jid = message.key?.remoteJid;
    if (!jid) return;

    try {
      // ── Show typing indicator ──────────────────────────────────────────────
      try { await sendTyping(jid, sessionId); } catch { /* non-critical */ }

      // ── Download voice note from WhatsApp ──────────────────────────────────
      const buffer = await downloadWhatsAppAudio(message);
      if (!buffer || buffer.length < 100) {
        await sendMessage(jid, '⚠️ Could not download your voice message. Please try again.', sessionId);
        return;
      }

      console.log(`🎤 Voice note received from ${jid}: ${buffer.length} bytes`);

      // ── Transcribe using configured provider (OpenAI Whisper → Gemini) ─────
      let transcription = '';
      let detectedLang = 'en';

      try {
        const result = await transcribeAudioWithLanguage(buffer);
        transcription = result.text;
        detectedLang = result.detectedLanguage;
        console.log(`   ✅ Transcribed (${detectedLang}): "${transcription.substring(0, 100)}..."`);
      } catch (sttErr: any) {
        console.error('   ❌ Transcription failed:', sttErr.message);
        await sendMessage(jid, '⚠️ Could not transcribe your voice message. Please try again.', sessionId);
        return;
      }

      if (!transcription || transcription.trim().length < 2) {
        await sendMessage(jid, '⚠️ Voice message was too short or silent. Please try again.', sessionId);
        return;
      }

      // ── Check voice agent config ───────────────────────────────────────────
      const voiceMode = await getVoiceMode();
      const agentEnabled = await isVoiceAgentEnabled();

      console.log(`   Voice Mode: ${voiceMode}, Agent Enabled: ${agentEnabled}`);

      if (!agentEnabled) {
        // Agent disabled — just echo the transcription
        await sendMessage(
          jid,
          `🎤 *Voice Transcription:*\n\n"${transcription}"\n\n_Voice AI is currently disabled in settings._`,
          sessionId,
        );
        return;
      }

      // ── Generate AI response for ALL voice messages (not just questions) ───
      const aiResponse = await aiLoadBalancer.sendMessage(jid, transcription);

      const shouldSendText  = voiceMode === 'text-only'  || voiceMode === 'voice-and-text';
      const shouldSendVoice = voiceMode === 'voice-only' || voiceMode === 'voice-and-text';

      // Send text response (includes transcription so user can read what was heard)
      if (shouldSendText) {
        await sendMessage(
          jid,
          `🎤 *You said:*\n"${transcription}"\n\n🤖 *AI Response:*\n${aiResponse}`,
          sessionId,
        );
      }

      // Generate and send TTS voice reply
      if (shouldSendVoice) {
        try {
          const audioBuffer = await generateSpeech(aiResponse, detectedLang);
          await sendVoiceMessage(jid, audioBuffer, sessionId);
          console.log(`   ✅ Voice reply sent to ${jid}`);
        } catch (ttsErr: any) {
          console.error('   ❌ TTS failed:', ttsErr.message);
          // If we haven't sent text yet, fall back to text
          if (!shouldSendText) {
            await sendMessage(
              jid,
              `🎤 *You said:*\n"${transcription}"\n\n🤖 *AI Response:*\n${aiResponse}\n\n_Voice reply unavailable: ${ttsErr.message}_`,
              sessionId,
            );
          }
        }
      }

    } catch (error: any) {
      console.error('❌ Voice processing error:', error);

      const userMsg = (error.message?.includes('429') || error.message?.includes('quota'))
        ? '⚠️ AI quota exceeded. Please wait a moment and try again.'
        : '⚠️ Could not process your voice message. Please try again.';

      try { await sendMessage(jid, userMsg, sessionId); } catch { /* ignore secondary error */ }
    }
  }
}
