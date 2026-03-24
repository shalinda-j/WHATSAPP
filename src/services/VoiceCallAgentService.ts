import { aiLoadBalancer } from './AILoadBalancer';
import { generateSpeech } from './voice';
import CallLog from '../models/CallLog';
import { configService } from './ConfigService';

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
    try {
      const config = await configService.getConfig();
      return (config as any)?.callAgentEnabled ?? false;
    } catch {
      return this.isEnabled;
    }
  }

  async enableCallAgent(enabled: boolean): Promise<void> {
    this.isEnabled = enabled;
    try {
      await configService.updateConfig({ callAgentEnabled: enabled });
    } catch (err) {
      console.error('Failed to persist call agent setting:', err);
    }
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

    const enabled = await this.isCallAgentEnabled();

    if (!enabled) {
      // Auto-reject: log and return
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

    const greeting = this.callGreeting[language] || this.callGreeting.en;

    // Generate AI greeting
    let responseText = greeting;
    try {
      const systemPrompt = this.agentPersonality ||
        `You are a professional WhatsApp voice call assistant. 
        Keep responses SHORT (2-3 sentences max) for voice calls. 
        Be friendly and helpful. Speak naturally.`;

      const aiResponse = await aiLoadBalancer.chat(
        [{ role: 'user', content: `A caller just connected. Generate a brief, warm greeting for a voice call. Language: ${language}` }],
        systemPrompt,
      );

      if (aiResponse) responseText = aiResponse;
    } catch {
      // Use default greeting on AI failure
    }

    callLog.aiResponseText = responseText;

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

    await callLog.save().catch(() => {});

    return {
      accepted: true,
      responseText,
      responseAudioBuffer: audioBuffer,
      logId: callLog._id?.toString(),
    };
  }

  /**
   * Log a missed call
   */
  async logMissedCall(callerId: string, sessionId: string): Promise<void> {
    try {
      await new CallLog({
        sessionId,
        callerId,
        callerPhone: callerId.replace('@s.whatsapp.net', '').replace('@c.us', ''),
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        status: 'missed',
        direction: 'incoming',
      }).save();
    } catch {
      // Silently handle
    }
  }

  /**
   * Get call logs for a session
   */
  async getCallLogs(sessionId?: string, limit: number = 50): Promise<ICallLog[]> {
    try {
      const query = sessionId ? { sessionId } : {};
      return await CallLog.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
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
      const query = sessionId ? { sessionId } : {};
      const logs = await CallLog.find(query).lean();

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
    } catch (err) {
      // Non-critical, ignore
    }
  }
}

export const voiceCallAgent = new VoiceCallAgentService();
