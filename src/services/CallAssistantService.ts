import { randomUUID } from 'crypto';
import { sendMessage, sendVoiceMessage } from './whatsapp';
import { generateSpeech } from './voice';
import ChatMessage from '../models/ChatMessage';
import CallLog from '../models/CallLog';
import { agentOrchestrator } from './AgentOrchestrator';
import { voiceCallAgent } from './VoiceCallAgentService';
import Tenant from '../models/Tenant';

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

    const startedAt = new Date();
    try {
      // Step 1: Reject the call (Baileys limitation)
      await rejectCall(callId, from);
      console.log(`📞 Rejected call from ${from} on session ${sessionId}`);

      // Step 2: Load the admin-configured Call Agent settings (Voice Agent
      // Hub). Previously the operator's greeting/personality/language had NO
      // effect because the runtime call path used only this service, while the
      // admin UI wrote to VoiceCallAgentService. We now read those settings
      // here so the configured fields actually shape the reply. (We do NOT
      // gate the auto-reply itself on the UI toggle — its default is "off",
      // and silencing a currently-working call reply on deploy would be a
      // regression; CALL_ASSISTANT_ENABLED=false remains the hard kill-switch.)
      const agentEnabled = await voiceCallAgent.isCallAgentEnabled();
      const agentSettings = voiceCallAgent.getSettings();
      const configuredLang = agentSettings.language;

      // Prefer the operator's configured primary language when the agent is
      // enabled and it's one we can synthesize; else detect from past messages.
      const language: 'si' | 'en' | 'ta' =
        agentEnabled &&
        (configuredLang === 'si' ||
          configuredLang === 'en' ||
          configuredLang === 'ta')
          ? configuredLang
          : await this.detectUserLanguage(from);

      // Step 3: Generate reply.
      // First try the agent orchestrator so the reply is dataset-driven,
      // RAG-augmented, and trained per agent. This is what makes the voice
      // agent "self-improving" — operators add training examples on the
      // Agent Training panel and the next call automatically benefits.
      // When the operator set a personality/greeting, those are threaded in.
      // Falls back to the static multilingual template if the orchestrator
      // produces no outbound (no active agent, all agents disabled, etc).
      const responseMessage = await this.generateSmartReply({
        from,
        sessionId,
        language,
        personality: agentEnabled ? agentSettings.personality : '',
        greetingFallback: agentEnabled ? agentSettings.greeting : '',
      });

      // Step 4: Send text response
      await sendMessage(from, responseMessage, sessionId);

      // Step 5: Generate and send voice note response
      let voiceSent = false;
      try {
        const audioBuffer = await generateSpeech(responseMessage);
        await sendVoiceMessage(from, audioBuffer, sessionId);
        voiceSent = true;
        console.log(`   🗣️ Voice response sent to ${from}`);
      } catch (ttsErr) {
        console.warn(`   ⚠️ TTS failed for call response:`, ttsErr);
      }

      // Step 6: Log the interaction in-memory
      this.logCall({
        callId,
        from,
        sessionId,
        timestamp: startedAt,
        action: 'rejected',
        responseType: voiceSent ? 'both' : 'text',
      });

      // Step 7: Persist to DB — both the chat trail and the dedicated
      // CallLog row so the Call Logs UI can show this call with the
      // actual reply text, not just a "rejected" stub.
      try {
        // Stamp the default tenant so chat-derived exports/analytics scope
        // this row correctly. The WhatsApp call path has no tenant header,
        // so we resolve the single-tenant default (auto-created by
        // resolveTenant for single-tenant deployments).
        const defaultTenant = await Tenant.findOne({ slug: 'default' });
        await ChatMessage.create({
          userId: from,
          role: 'assistant',
          type: 'text',
          content: `[CALL REJECTED] ${responseMessage}`,
          tenantId: defaultTenant?._id,
          metadata: { sessionId, intent: 'Call Auto-Reply' },
        });
      } catch (dbErr) {
        console.error('Failed to log call to DB:', dbErr);
      }
      try {
        await CallLog.create({
          sessionId,
          callerId: from,
          callerPhone: from.split('@')[0],
          startTime: startedAt,
          endTime: new Date(),
          duration: 0,
          status: 'rejected',
          direction: 'incoming',
          aiResponseText: responseMessage,
          language,
        });
      } catch (dbErr) {
        console.error('Failed to write CallLog row:', dbErr);
      }
    } catch (error) {
      console.error(`❌ Error handling call from ${from}:`, error);
    }
  }

  /**
   * Try the agent orchestrator first; fall back to the static template if
   * no agent handles the call-attempt intent. Wrapping in try/catch so a
   * misbehaving agent never blocks the call response — silence on a real
   * incoming call is the worst possible outcome.
   */
  private async generateSmartReply(opts: {
    from: string;
    sessionId: string;
    language: 'si' | 'en' | 'ta';
    personality?: string;
    greetingFallback?: string;
  }): Promise<string> {
    // The operator's custom greeting (Voice Agent Hub) takes precedence over
    // the generic hardcoded template as the static fallback when set.
    const fallback =
      opts.greetingFallback && opts.greetingFallback.trim()
        ? opts.greetingFallback.trim()
        : this.getCallResponseMessage(opts.language);
    try {
      // Resolve a tenantId so the orchestrator can pull tenant-scoped
      // training examples via RAG. For the WhatsApp call path we don't
      // have an explicit tenant header — use the `default` tenant which
      // resolveTenant auto-creates for single-tenant deployments.
      const defaultTenant = await Tenant.findOne({ slug: 'default' });
      const tenantId = defaultTenant ? String(defaultTenant._id) : '';

      // When the operator configured a persona, prepend it so the reply
      // adopts their brand voice instead of a generic one.
      const personalityPreamble =
        opts.personality && opts.personality.trim()
          ? `Adopt this persona for your reply: ${opts.personality.trim()}\n`
          : '';

      const outcome = await agentOrchestrator.handle({
        sessionId: opts.sessionId,
        userId: opts.from,
        channel: 'whatsapp',
        language: opts.language,
        inputMessage: `${personalityPreamble}[VOICE_CALL_ATTEMPT] The user attempted a live voice call.`,
        conversationHistory: [],
        traceId: randomUUID(),
        metadata: {
          intent: 'voice_call_attempt',
          tenantId,
        },
      });

      if (outcome.handled && outcome.outbound) {
        console.log(
          `   🧠 Voice-call reply generated by agent ${outcome.agentName}`,
        );
        return outcome.outbound;
      }
    } catch (err) {
      console.error('Orchestrator failed for voice-call reply:', err);
    }
    return fallback;
  }

  /**
   * Detect user's preferred language from past messages
   */
  private async detectUserLanguage(jid: string): Promise<'si' | 'en' | 'ta'> {
    try {
      const recentMessages = await ChatMessage.find({
        userId: jid,
        role: 'user',
      })
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
    console.log(
      `📞 Call logged: ${log.from} -> ${log.action} (${log.responseType})`,
    );
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
