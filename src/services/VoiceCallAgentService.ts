import { generateSpeech } from './voice';
import CallLog, { ICallLog } from '../models/CallLog';
import Config from '../models/Config';
import { aiLoadBalancer } from './AILoadBalancer';

const CONFIG_KEY = 'call_agent_settings';

/**
 * Voice Call Agent Service
 * Handles incoming WhatsApp voice calls with AI-powered responses.
 * Generates spoken responses and logs all call activity.
 * Settings are persisted to MongoDB so they survive restarts.
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
  private settingsLoaded: boolean = false;

  /**
   * Load settings from MongoDB (called lazily)
   */
  private async loadSettings(): Promise<void> {
    if (this.settingsLoaded) return;
    try {
      const config = await Config.findOne({ key: CONFIG_KEY }).lean();
      if (config && config.value) {
        const saved = JSON.parse(config.value);
        this.isEnabled = saved.isEnabled ?? false;
        this.primaryLanguage = saved.primaryLanguage ?? 'en';
        this.agentPersonality = saved.agentPersonality ?? '';
        if (saved.callGreeting) {
          this.callGreeting = { ...this.callGreeting, ...saved.callGreeting };
        }
      }
    } catch {
      // Non-critical: use in-memory defaults
    }
    this.settingsLoaded = true;
  }

  /**
   * Persist settings to MongoDB
   */
  private async saveSettings(): Promise<void> {
    try {
      const value = JSON.stringify({
        isEnabled: this.isEnabled,
        primaryLanguage: this.primaryLanguage,
        agentPersonality: this.agentPersonality,
        callGreeting: this.callGreeting,
      });
      await Config.findOneAndUpdate(
        { key: CONFIG_KEY },
        { key: CONFIG_KEY, value, description: 'Voice Call Agent Settings' },
        { upsert: true, new: true },
      );
    } catch (err) {
      console.error('Failed to persist call agent settings:', err);
    }
  }

  async isCallAgentEnabled(): Promise<boolean> {
    await this.loadSettings();
    return this.isEnabled;
  }

  async enableCallAgent(enabled: boolean): Promise<void> {
    await this.loadSettings();
    this.isEnabled = enabled;
    await this.saveSettings();
  }

  /**
   * Generate a dynamic AI response for the call greeting
   */
  private async generateDynamicGreeting(language: string): Promise<string> {
    if (!this.agentPersonality) {
      return this.callGreeting[language] || this.callGreeting.en;
    }

    try {
      const langNames: Record<string, string> = { en: 'English', si: 'Sinhala', ta: 'Tamil' };
      const langName = langNames[language] || 'English';
      const prompt = `You are a voice call agent with the following personality: "${this.agentPersonality}". 
A customer is calling on WhatsApp. Since live calls cannot be answered, generate a warm, professional greeting message to send back as a voice note in ${langName}. 
Keep it under 3 sentences. Be friendly and helpful. Do not mention you are an AI unless directly asked.`;

      const response = await aiLoadBalancer.sendMessage('call_agent_greeting', prompt);
      return response || this.callGreeting[language] || this.callGreeting.en;
    } catch {
      return this.callGreeting[language] || this.callGreeting.en;
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
    await this.loadSettings();
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

    // Answer the call (log as answered)
    callLog.status = 'answered';
    callLog.endTime = new Date();
    callLog.duration = 0;

    // Generate dynamic greeting using AI if personality is set, else use static
    const responseText = await this.generateDynamicGreeting(language);

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
      await this.loadSettings();
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
    this.saveSettings();
  }

  setCallGreeting(language: string, text: string): void {
    this.callGreeting[language] = text;
    this.saveSettings();
  }

  setPrimaryLanguage(language: string): void {
    this.primaryLanguage = language;
    this.saveSettings();
  }

  getSettings(): { language: string; greeting: string; personality: string; enabled: boolean } {
    return {
      language: this.primaryLanguage || 'en',
      greeting: this.callGreeting[this.primaryLanguage || 'en'] || '',
      personality: this.agentPersonality || '',
      enabled: this.isEnabled,
    };
  }
}

export const voiceCallAgent = new VoiceCallAgentService();
