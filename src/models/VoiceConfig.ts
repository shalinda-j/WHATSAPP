import mongoose, { Schema, Document } from 'mongoose';

export interface IVoiceConfig extends Document {
    provider: 'google-free' | 'openai' | 'elevenlabs';
    apiKey?: string;
    voiceId?: string; // For OpenAI or ElevenLabs specific voice IDs
    isActive: boolean;
    mode: 'voice-only' | 'text-only' | 'voice-and-text';
    updatedAt: Date;
}

const VoiceConfigSchema = new Schema({
    provider: {
        type: String,
        enum: ['google-free', 'openai', 'elevenlabs'],
        default: 'google-free',
    },
    apiKey: {
        type: String,
        required: false,
    },
    voiceId: {
        type: String,
        required: false,
        default: 'alloy',
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    mode: {
        type: String,
        enum: ['voice-only', 'text-only', 'voice-and-text'],
        default: 'voice-and-text',
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
} as any);

export default mongoose.model('VoiceConfig', VoiceConfigSchema as any) as any;
