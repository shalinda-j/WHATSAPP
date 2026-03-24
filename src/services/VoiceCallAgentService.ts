import { generateSpeech } from './voice';
import CallLog, { ICallLog } from '../models/CallLog';

/**
 * Voice Call Agent Service
 * Handles incoming WhatsApp voice calls with AI-powered responses.
 * Generates spoken responses and logs all call activity.
 */
export class VoiceCallAgentService {
  private isEnabled: boolean = false;
  private agentPersonality: string = '';
  private primaryLanguage: string = 'en';
  private callGreeting: Record<string, string> = {
    en: "Hello! Thank you for calling. I'm an AI assistant. How can I help you today?",
    si: "ආයුබෝවන්! ඔබේ ඇමතුම ගැන ස්තූතියි. මම AI සහකාරයෙකි. අද ඔබට කොහොමද සහාය වෙන්නේ?",
    ta: "வணக்கம்! அழைத்ததற்கு நன்றி. நான் ஒரு AI உதவியாளர். இன்று உங்களுக்கு எப்படி உதவலாம்?",
  };

  async isCallAgentEnabled(): Promise<boolean> {
    return this.isEnabled;
  }

  async enableCallAgent(enabled: boolean): Promise<void> {
    this.isEnabled = enabled;
  }

  /**
   * Handle an incoming WhatsApp call.
   * Called when a call event is detected in the WhatsApp service.
   */
  async handleIncomingCall(params: {
    callerId: string;
    callerName?: string;
    sessionId: string;
    language?: 'en' | 'si' | 'ta';
  }): Promise<{
    accepted: boolean;
    responseText?: string;
    responseAudioBuffer?: Buffer;
    logId?: string;
  }> {
    const { callerId, callerName, sessionId, language = 'en' } = params;

    // Log the incoming call
    const callLog = new CallLog({
      sessionId,
      callerId,
      callerName,
      callerPhone: callerId.replace('@s.whatsapp.net', '').replace('@c.us', ''),
      startTime: new Date(),
      status: 'missed',
      direction: 'incoming',
      language,
    });

    if (!this.isEnabled) {
      callLog.status = 'rejected';
      callLog.endTime = new Date();
      callLog.duration = 0;
      await callLog.save().catch(() => {});
      return { accepted: false, logId: callLog._id?.toString() };
    }

    // Answer the call
    callLog.status = 'answered';
    callLog.endTime = new Date();
    callLog.duration = 0;

    const responseText = this.callGreeting[language] || this.callGreeting.en;

    // Generate TTS audio
    let audioBuffer: Buffer | undefined;
    try {
      audioBuffer = await generateSpeech(responseText, language);
      if (audioBuffer) {
        callLog.aiResponseAudioUrl = 'generated';
      }
    } catch (err) {
      console.error('TTS generation failed for call:', err);
    }

    callLog.aiResponseText = responseText;
    await callLog.save().catch(() => {});

    return {
      accepted: true,
      responseText,
      responseAudioBuffer: audioBuffer,
      logId: callLog._id?.toString(),
    };
  }

  /**
   * Log a missed/rejected call (for default non-agent mode)
   */
  async logMissedCall(callerId: string, sessionId: string): Promise<void> {
    try {
      await CallLog.create({
        sessionId,
        callerId,
        callerPhone: callerId.replace('@s.whatsapp.net', '').replace('@c.us', ''),
        startTime: new Date(),
        endTime: new Date(),
        status: 'missed',
        direction: 'incoming',
        duration: 0,
        language: this.primaryLanguage || 'en',
      });
    } catch {
      // Non-critical, ignore
    }
  }

  /**
   * Get call logs for a session
   */
  async getCallLogs(sessionId?: string, limit: number = 50): Promise<any[]> {
    try {
      const query: Record<string, any> = sessionId ? { sessionId } : {};
      return await CallLog.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean<ICallLog[]>();
    } catch {
      return [];
    }
  }

  /**
   * Get call statistics
   */
  async getCallStats(sessionId?: string): Promise<{
    total: number;
    answered: number;
    missed: number;
    rejected: number;
    avgDuration: number;
  }> {
    try {
      const query: Record<string, any> = sessionId ? { sessionId } : {};
      const logs = await CallLog.find(query).lean<ICallLog[]>();

      const total = logs.length;
      const answered = logs.filter(l => l.status === 'answered').length;
      const missed = logs.filter(l => l.status === 'missed').length;
      const rejected = logs.filter(l => l.status === 'rejected').length;
      const durations = logs.filter(l => l.duration).map(l => l.duration || 0);
      const avgDuration = durations.length
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

      return { total, answered, missed, rejected, avgDuration };
    } catch {
      return { total: 0, answered: 0, missed: 0, rejected: 0, avgDuration: 0 };
    }
  }

  setAgentPersonality(personality: string): void {
    this.agentPersonality = personality;
  }

  setCallGreeting(language: string, text: string): void {
    this.callGreeting[language] = text;
  }

  setPrimaryLanguage(language: string): void {
    this.primaryLanguage = language;
  }

  getSettings(): { language: string; greeting: string } {
    return {
      language: this.primaryLanguage || 'en',
      greeting: this.callGreeting[this.primaryLanguage || 'en'] || '',
    };
  }
}

export const voiceCallAgent = new VoiceCallAgentService();
