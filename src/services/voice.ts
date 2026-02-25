import { transcribeAudio as openaiTranscribeAudio } from './openai';
import { transcribeAudio as geminiTranscribeAudio } from './gemini';
import { getAudioUrl } from 'google-tts-api';
import OpenAI from 'openai';
import axios from 'axios';
import VoiceConfig from '../models/VoiceConfig';

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
      return await openaiTranscribeAudio(audioBuffer, config.apiKey);
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
      const client = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });

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
    const lang = hasSinhala ? 'si' : 'en';

    console.log(`   🗣️ Google TTS - Language detected: ${lang}`);

    // TRUNCATE TEXT: Google TTS API (Free) fails on long text > 200 chars
    // We strictly truncate it to ensure reliability for voice replies.
    let processText = text;
    if (processText.length > 195) {
      console.warn('   ⚠️ Text too long for Google TTS, truncating to 195 chars...');
      processText = processText.substring(0, 195) + '...';
    }

    const url = getAudioUrl(processText, {
      lang: lang,
      slow: false,
      host: 'https://translate.google.com'
    });

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (error: any) {
    console.error('❌ Google Speech generation error:', error.message || error);
    // Return a silent buffer or throw? prefer throw so we fallback to text
    throw new Error('Failed to generate speech');
  }
}
