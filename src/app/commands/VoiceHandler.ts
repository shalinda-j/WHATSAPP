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

      // ── Build language-aware prompt ────────────────────────────────────────
      const langInstructions: Record<string, string> = {
        si: '\n\n(SYSTEM: මෙය VOICE (හඬ) පණිවිඩයකි. **සිංහල** භාෂාවෙන් ප්‍රතිඋත්තර දෙන්න. ඉතා කෙටිව, ස්වාභාවිකව කතා කරන ශෛලියෙන් යෙදුම් 1-2කින් ලිවිය යුතුය.)',
        en: '\n\n(SYSTEM: This is a VOICE message. Reply ONLY in English, short and natural — 1-2 sentences max.)',
        ta: '\n\n(SYSTEM: இது ஒலி செய்தி. தமிழில் மட்டும் பதிலளிக்கவும். 1-2 வாக்கியங்களில் இயல்பான பேச்சு வழக்கில் பதிலளிக்கவும்.)',
        hi: '\n\n(SYSTEM: यह एक VOICE संदेश है। हिंदी में ही जवाब दें। 1-2 वाक्यों में स्वाभाविक तरीके से।)',
      };
      const langInstruction = langInstructions[detectedLang] || langInstructions.si;
      const finalPrompt = transcription + langInstruction;

      // ── Generate AI response for ALL voice messages ────────────────────────
      const aiResponse = await aiLoadBalancer.sendMessage(jid, finalPrompt);

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
