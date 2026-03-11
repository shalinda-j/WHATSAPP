import { transcribeAudio as openaiTranscribeAudio } from './openai';
import { transcribeAudio as geminiTranscribeAudio } from './gemini';
import { getAudioUrl } from 'google-tts-api';
import OpenAI from 'openai';
import axios from 'axios';
import VoiceConfig from '../models/VoiceConfig';

/**
 * Detect language from text content
 * Supports Sinhala (si-LK), English (en-US), and Tamil (ta-LK)
 */
export function detectLanguage(text: string): { code: string; name: string; ttsCode: string } {
  const hasSinhala = /[\u0D80-\u0DFF]/.test(text);
  const hasTamil = /[\u0B80-\u0BFF]/.test(text);

  if (hasSinhala) return { code: 'si-LK', name: 'sinhala', ttsCode: 'si' };
  if (hasTamil) return { code: 'ta-LK', name: 'tamil', ttsCode: 'ta' };
  return { code: 'en-US', name: 'english', ttsCode: 'en' };
}

/**
 * Transcribe audio using configured provider (Gemini or OpenAI)
 * @param audioBuffer Buffer containing the audio data
 * @returns Transcribed text
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  try {
    const config = await VoiceConfig.findOne().sort({ updatedAt: -1 });
    const provider = config?.provider || 'google-free';

    if (provider === 'openai' && config?.apiKey) {
      console.log('   🎙️ Transcribing audio with OpenAI Whisper...');
      try {
        return await openaiTranscribeAudio(audioBuffer, config.apiKey);
      } catch (openaiErr: any) {
        console.warn(`   ⚠️ OpenAI STT failed: ${openaiErr.message}. Falling back to Gemini...`);
        // Fallthrough to Gemini
      }
    }

    console.log('   🎙️ Transcribing audio with Gemini...');

    // Convert Buffer to Base64 for Gemini
    const audioBase64 = audioBuffer.toString('base64');

    // Use Gemini's multimodal transcription
    const transcription = await geminiTranscribeAudio(audioBase64, 'audio/ogg');

    return transcription;
  } catch (error: any) {
    console.error('❌ Transcription error:', error.message || error);
    throw new Error('Failed to transcribe audio');
  }
}

/**
 * Generate speech from text using configured provider
 */
export async function generateSpeech(text: string): Promise<Buffer> {
  // Fetch config from DB
  const config = await VoiceConfig.findOne().sort({ updatedAt: -1 });

  // If voice is disabled in config, return empty buffer or throw generic error to be handled by caller
  if (config && !config.isActive) {
    console.log('   🔇 Voice Agent is disabled in Admin Config.');
    throw new Error('Voice Agent Disabled');
  }

  const provider = config?.provider || 'google-free';
  const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;

  console.log(`   🔊 Generating speech using provider: ${provider}`);

  if (provider === 'elevenlabs') {
    try {
      if (!apiKey) {
        throw new Error('ElevenLabs API Key is missing in config');
      }

      const voiceId = config?.voiceId || 'pNInz6obpgDQGcFmaJcg'; // Default to a standard voice if none provided
      const modelId = config?.ttsModel || 'eleven_multilingual_v2';

      console.log(`   🎙️ Calling ElevenLabs TTS API (Voice ID: ${voiceId})...`);

      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          }
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );

      return Buffer.from(response.data);

    } catch (err: any) {
      console.error(`   ⚠️ ElevenLabs TTS failed: ${err.message}. Falling back to Google Free.`);
      // Fallback to Google
    }
  }

  if (provider === 'openai') {
    try {
      if (!apiKey) {
        throw new Error('OpenAI API Key is missing in config');
      }

      // Re-init OpenAI with new key if needed
      const client = new OpenAI({ apiKey: apiKey });

      console.log(`   🎙️ Calling OpenAI TTS API (Voice ID: ${config?.voiceId || 'alloy'})...`);

      const mp3 = await client.audio.speech.create({
        model: (config?.ttsModel as any) || "tts-1",
        voice: (config?.voiceId as any) || "alloy",
        input: text,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      return buffer;

    } catch (err: any) {
      console.error(`   ⚠️ OpenAI TTS failed: ${err.message}. Falling back to Google Free.`);
      // Fallback
    }
  }

  // Google TTS (Default/Fallback)
  return generateSpeechGoogle(text);
}

/**
 * Generate speech using google-tts-api (Unofficial Free API)
 */
async function generateSpeechGoogle(text: string): Promise<Buffer> {
  try {
    const hasSinhala = /[\u0D80-\u0DFF]/.test(text);
    const hasTamil = /[\u0B80-\u0BFF]/.test(text);
    const lang = hasSinhala ? 'si' : hasTamil ? 'ta' : 'en';
    console.log(`   🗣️ Google TTS - Language detected: ${lang}`);

    // Split long text into chunks for Google TTS (limit ~195 chars)
    const chunks = splitTextForTTS(text, 190);
    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      const url = getAudioUrl(chunk, {
        lang: lang,
        slow: false,
        host: 'https://translate.google.com'
      });
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      audioBuffers.push(Buffer.from(response.data));
    }

    return Buffer.concat(audioBuffers);
  } catch (error: any) {
    console.error('❌ Google Speech generation error:', error.message || error);
    throw new Error('Failed to generate speech');
  }
}

function splitTextForTTS(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Find best split point (sentence boundary)
    let splitAt = remaining.lastIndexOf('. ', maxLen);
    if (splitAt < maxLen / 2) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.substring(0, splitAt + 1).trim());
    remaining = remaining.substring(splitAt + 1).trim();
  }
  return chunks.filter(c => c.length > 0);
}
