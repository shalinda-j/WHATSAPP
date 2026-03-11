import { sendMessage, sendVoiceMessage } from './whatsapp';
import { generateSpeech } from './voice';
import ChatMessage from '../models/ChatMessage';

/**
 * Call Assistant Service
 *
 * NOTE: WhatsApp (via Baileys) does NOT support native voice call streaming.
 * This service implements the best available workaround:
 * 1. Auto-rejects incoming calls
 * 2. Sends an intelligent voice note explaining the caller should send a voice note
 * 3. When the user sends a voice note, processes it through the AI pipeline
 * 4. Logs all call interactions for analytics
 *
 * For true voice call handling, a dedicated telephony provider (Twilio, Vonage)
 * would need to be integrated with WebRTC bridging.
 */

interface CallLog {
  callId: string;
  from: string;
  sessionId: string;
  timestamp: Date;
  action: 'rejected' | 'answered';
  responseType: 'text' | 'voice' | 'both';
}

class CallAssistantService {
  private callLogs: CallLog[] = [];
  private readonly enabled: boolean;
  private readonly autoReplyMessage: string;

  constructor() {
    this.enabled = process.env.CALL_ASSISTANT_ENABLED !== 'false';
    this.autoReplyMessage =
      process.env.CALL_AUTO_REPLY_MESSAGE ||
      'I am an AI assistant and cannot take live calls. Please send me a Voice Note instead!';
  }

  /**
   * Handle an incoming WhatsApp call
   * Since Baileys cannot answer calls with audio streaming,
   * we reject the call and send a helpful voice + text response.
   */
  async handleIncomingCall(
    callId: string,
    from: string,
    sessionId: string,
    rejectCall: (callId: string, from: string) => Promise<void>,
  ): Promise<void> {
    if (!this.enabled) {
      console.log(`📞 Call assistant disabled, ignoring call from ${from}`);
      return;
    }

    try {
      // Step 1: Reject the call (Baileys limitation)
      await rejectCall(callId, from);
      console.log(`📞 Rejected call from ${from} on session ${sessionId}`);

      // Step 2: Detect caller's likely language from previous messages
      const language = await this.detectUserLanguage(from);

      // Step 3: Generate appropriate response message
      const responseMessage = this.getCallResponseMessage(language);

      // Step 4: Send text response
      await sendMessage(from, responseMessage, sessionId);

      // Step 5: Generate and send voice note response
      try {
        const audioBuffer = await generateSpeech(responseMessage);
        await sendVoiceMessage(from, audioBuffer, sessionId);
        console.log(`   🗣️ Voice response sent to ${from}`);
      } catch (ttsErr) {
        console.warn(`   ⚠️ TTS failed for call response:`, ttsErr);
      }

      // Step 6: Log the interaction
      this.logCall({
        callId,
        from,
        sessionId,
        timestamp: new Date(),
        action: 'rejected',
        responseType: 'both',
      });

      // Step 7: Save to database
      try {
        await ChatMessage.create({
          userId: from,
          role: 'assistant',
          type: 'text',
          content: `[CALL REJECTED] ${responseMessage}`,
          metadata: { sessionId, intent: 'Call Auto-Reply' },
        });
      } catch (dbErr) {
        console.error('Failed to log call to DB:', dbErr);
      }
    } catch (error) {
      console.error(`❌ Error handling call from ${from}:`, error);
    }
  }

  /**
   * Detect user's preferred language from past messages
   */
  private async detectUserLanguage(jid: string): Promise<'si' | 'en' | 'ta'> {
    try {
      const recentMessages = await ChatMessage.find({ userId: jid, role: 'user' })
        .sort({ createdAt: -1 })
        .limit(5);

      for (const msg of recentMessages) {
        if (/[\u0D80-\u0DFF]/.test(msg.content)) return 'si';
        if (/[\u0B80-\u0BFF]/.test(msg.content)) return 'ta';
      }
    } catch {
      // DB not available, default to Sinhala
    }
    return process.env.DEFAULT_LANGUAGE === 'english'
      ? 'en'
      : process.env.DEFAULT_LANGUAGE === 'tamil'
        ? 'ta'
        : 'si';
  }

  /**
   * Generate call response message in the appropriate language
   */
  private getCallResponseMessage(language: 'si' | 'en' | 'ta'): string {
    switch (language) {
      case 'si':
        return [
          '⚠️ *ස්වයංක්‍රීය පිළිතුර*',
          '',
          'මම AI සහකාරයෙකි. සජීවී ඇමතුම් ලබා ගැනීමට මට හැකියාවක් නැත.',
          '',
          'කරුණාකර *Voice Note* (හඬ පණිවිඩයක්) එවන්න - මම ඔබට පිළිතුරු දෙන්නම්! 🎤',
          '',
          '_I am an AI assistant. Please send me a Voice Note instead!_',
        ].join('\n');

      case 'ta':
        return [
          '⚠️ *தானியங்கி பதில்*',
          '',
          'நான் ஒரு AI உதவியாளர். நேரடி அழைப்புகளை எடுக்க என்னால் இயலாது.',
          '',
          'தயவுசெய்து *Voice Note* (குரல் செய்தி) அனுப்பவும் - நான் உங்களுக்கு பதிலளிப்பேன்! 🎤',
          '',
          '_I am an AI assistant. Please send me a Voice Note instead!_',
        ].join('\n');

      default:
        return [
          '⚠️ *Auto-Reply*',
          '',
          'I am an AI assistant and cannot take live voice calls.',
          '',
          'Please send me a *Voice Note* instead, and I will reply to you! 🎤',
        ].join('\n');
    }
  }

  private logCall(log: CallLog): void {
    this.callLogs.push(log);
    // Keep only last 1000 logs in memory
    if (this.callLogs.length > 1000) {
      this.callLogs = this.callLogs.slice(-500);
    }
    console.log(`📞 Call logged: ${log.from} -> ${log.action} (${log.responseType})`);
  }

  getCallLogs(): CallLog[] {
    return [...this.callLogs];
  }

  getStats(): { totalCalls: number; recentCalls: number } {
    const oneHourAgo = new Date(Date.now() - 3600000);
    return {
      totalCalls: this.callLogs.length,
      recentCalls: this.callLogs.filter((l) => l.timestamp > oneHourAgo).length,
    };
  }
}

export const callAssistant = new CallAssistantService();
