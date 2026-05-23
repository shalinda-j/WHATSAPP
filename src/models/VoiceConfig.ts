import mongoose, { Schema } from 'mongoose';
import { CryptoService } from '../services/CryptoService';

export type VoiceProvider =
  | 'google-free'
  | 'google-cloud'
  | 'gemini-tts'
  | 'openai'
  | 'elevenlabs';
export type VoiceMode = 'voice-only' | 'text-only' | 'voice-and-text';

export interface IVoiceConfig {
  provider: VoiceProvider;
  apiKey?: string; // OpenAI / ElevenLabs API key (encrypted at rest)
  googleApiKey?: string; // Google Cloud TTS API key (encrypted at rest)
  voiceId?: string; // Voice ID for the selected provider
  isActive: boolean;
  mode: VoiceMode;
  updatedAt: Date;
  ttsModel?: string; // Model name (e.g. tts-1, eleven_multilingual_v2)
}

// SECURITY: apiKey + googleApiKey are encrypted at rest using AES-256-CBC
// via CryptoService.encrypt/decrypt, mirroring the pattern used by
// `src/models/Config.ts` for AI-provider keys. Both fields previously sat
// in MongoDB as plaintext, which meant a DB dump or system-export leak
// surfaced live STT/TTS provider credentials.
//
// Notes:
// - `toJSON: { getters: true }` makes route handlers see the DECRYPTED
//   value when they call `.toJSON()` or send via `res.json(doc)`.
// - The setter guards empty strings so we don't store `enc:` cipher
//   wrappers for unset keys.
// - Mongoose runs the setter on every write — including when the same
//   document is re-saved — so a doc written before this change will be
//   re-encrypted the next time it's saved through the model.
const encryptedKey = {
  type: String,
  required: false,
  set: (val: string | undefined | null) => {
    if (val === undefined || val === null || val === '') return val;
    return CryptoService.encrypt(val);
  },
  get: (val: string | undefined | null) => {
    if (val === undefined || val === null || val === '') return val;
    return CryptoService.decrypt(val);
  },
};

const VoiceConfigSchema = new Schema<IVoiceConfig>(
  {
    provider: {
      type: String,
      enum: ['google-free', 'google-cloud', 'gemini-tts', 'openai', 'elevenlabs'],
      default: 'google-free',
    },
    apiKey: encryptedKey,
    googleApiKey: encryptedKey,
    voiceId: { type: String, required: false, default: 'alloy' },
    isActive: { type: Boolean, default: true },
    mode: {
      type: String,
      enum: ['voice-only', 'text-only', 'voice-and-text'],
      default: 'voice-and-text',
    },
    updatedAt: { type: Date, default: Date.now },
    ttsModel: { type: String, default: 'tts-1' },
  },
  {
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

const VoiceConfig = (mongoose.models.VoiceConfig ||
  mongoose.model(
    'VoiceConfig',
    VoiceConfigSchema as any,
  )) as unknown as mongoose.Model<IVoiceConfig>;

export default VoiceConfig;
