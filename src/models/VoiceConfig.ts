import mongoose, { Schema } from 'mongoose';

export type VoiceProvider = 'google-free' | 'google-cloud' | 'gemini-tts' | 'openai' | 'elevenlabs';
export type VoiceMode = 'voice-only' | 'text-only' | 'voice-and-text';

export interface IVoiceConfig {
  provider: VoiceProvider;
  apiKey?: string;           // OpenAI / ElevenLabs API key
  googleApiKey?: string;     // Google Cloud TTS API key (separate field)
  voiceId?: string;          // Voice ID for the selected provider
  isActive: boolean;
  mode: VoiceMode;
  updatedAt: Date;
  ttsModel?: string;         // Model name (e.g. tts-1, eleven_multilingual_v2)
}

const VoiceConfigSchema = new Schema<IVoiceConfig>({
  provider: {
    type: String,
    enum: ['google-free', 'google-cloud', 'gemini-tts', 'openai', 'elevenlabs'],
    default: 'google-free',
  },
  apiKey: { type: String, required: false },
  googleApiKey: { type: String, required: false },
  voiceId: { type: String, required: false, default: 'alloy' },
  isActive: { type: Boolean, default: true },
  mode: {
    type: String,
    enum: ['voice-only', 'text-only', 'voice-and-text'],
    default: 'voice-and-text',
  },
  updatedAt: { type: Date, default: Date.now },
  ttsModel: { type: String, default: 'tts-1' },
});

const VoiceConfig = mongoose.model(
  'VoiceConfig',
  VoiceConfigSchema as any,
) as unknown as mongoose.Model<IVoiceConfig>;

export default VoiceConfig;
