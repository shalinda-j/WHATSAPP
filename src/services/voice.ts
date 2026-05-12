/**
 * Voice Service — TTS (Text-to-Speech) + STT (Transcription)
 *
 * TTS Waterfall routing per language:
 *
 * All languages (en / ta / hi / si):
 *   1. Gemini TTS        (gemini-2.5-flash-preview-tts — uses GEMINI_API_KEY, 30 voices,
 *                         natively supports Sinhala/Tamil/Hindi/English + 100+ languages)
 *   2. Google Cloud TTS  (official Neural2 voices, separate googleApiKey, NO Sinhala)
 *   3. OpenAI TTS        (tts-1/tts-1-hd, requires apiKey)
 *   4. ElevenLabs        (premium, requires apiKey)
 *   5. Google Free TTS   (unofficial Google Translate, no API key, always last resort)
 *
 * Sinhala note: Gemini TTS now handles Sinhala natively (si BCP-47).
 * Google Cloud TTS is still skipped for Sinhala (no native voice).
 */

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
  const result = await transcribeAudioWithLanguage(audioBuffer);
  return result.text;
}

export async function transcribeAudioWithLanguage(
  audioBuffer: Buffer,
): Promise<TranscriptionResult> {
  let config = null;
  try {
    config = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
  } catch {}

  const provider = config?.provider || 'google-free';
  const apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';

  let text = '';

  // ── Step 1: Try OpenAI Whisper (if API key is configured) ─────────────────
  // Whisper supports: flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm
  if (apiKey && (provider === 'openai' || provider === 'google-cloud')) {
    try {
      console.log('   🎙️ Trying OpenAI Whisper STT...');
      text = await openaiTranscribeAudio(audioBuffer, apiKey);
      if (text)
        console.log(`   ✅ OpenAI Whisper: "${text.substring(0, 60)}..."`);
    } catch (err: any) {
      console.warn(`   ⚠️ OpenAI Whisper failed: ${err.message}`);
    }
  }

  // ── Step 2: Try Gemini audio transcription (primary free option) ───────────
  // Gemini 1.5 Flash supports audio/ogg natively (WhatsApp PTT format)
  if (!text) {
    try {
      console.log('   🎙️ Trying Gemini STT...');

      // Try with the audio/ogg MIME type (WhatsApp PTT format)
      text = await geminiTranscribeAudio(
        audioBuffer.toString('base64'),
        'audio/ogg',
      );

      if (text) console.log(`   ✅ Gemini: "${text.substring(0, 60)}..."`);
    } catch (err: any) {
      console.warn(`   ⚠️ Gemini STT failed: ${err.message}`);
      text = '';
    }
  }

  // ── Step 3: Try Gemini with alternative MIME type ─────────────────────────
  if (!text) {
    try {
      console.log('   🎙️ Trying Gemini STT with audio/webm...');
      text = await geminiTranscribeAudio(
        audioBuffer.toString('base64'),
        'audio/webm',
      );
      if (text)
        console.log(`   ✅ Gemini (webm): "${text.substring(0, 60)}..."`);
    } catch (err: any) {
      console.warn(`   ⚠️ Gemini STT (webm fallback) failed: ${err.message}`);
      text = '';
    }
  }

  // ── Step 4: If all STT failed, return empty (caller will handle gracefully) ─
  if (!text || text.trim().length < 2) {
    console.error(
      '   ❌ All STT providers failed — returning empty transcription',
    );
    return { text: '', detectedLanguage: 'si', languageConfidence: 0 };
  }

  const langResult = detectLanguage(text);
  console.log(
    `   🌐 Language: ${
      langResult.lang
    } (confidence: ${langResult.confidence.toFixed(2)})`,
  );

  return {
    text,
    detectedLanguage: langResult.lang,
    languageConfidence: langResult.confidence,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// TTS — Waterfall Provider System
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Google Cloud TTS voice names per language (Neural2 quality).
 * Sinhala is intentionally absent — Google Cloud has no Sinhala voice.
 */
const GOOGLE_CLOUD_VOICES: Record<
  string,
  { languageCode: string; name: string; gender: string }
> = {
  en: { languageCode: 'en-US', name: 'en-US-Neural2-F', gender: 'FEMALE' },
  ta: { languageCode: 'ta-IN', name: 'ta-IN-Neural2-B', gender: 'FEMALE' },
  hi: { languageCode: 'hi-IN', name: 'hi-IN-Neural2-A', gender: 'FEMALE' },
};

/**
 * Google Translate TTS language codes.
 * Sinhala works here even though it's unavailable in Google Cloud TTS.
 */
const GOOGLE_FREE_LANG_MAP: Record<string, string> = {
  en: 'en',
  si: 'si',
  ta: 'ta',
  hi: 'hi',
};

/**
 * Wrap text in SSML for a warm, friendly, conversational tone.
 * Speaking rate 0.95 (slightly slower for clarity), pitch +2st for warmth.
 */
function wrapSSML(text: string): string {
  // Escape XML special characters
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<speak><prosody rate="0.95" pitch="+2st">${safe}</prosody></speak>`;
}

// ─── Individual provider functions ────────────────────────────────────────────

/**
 * Convert raw PCM (s16le) to a WAV file buffer.
 * Gemini TTS returns 24000Hz, 16-bit, mono PCM.
 */
function pcmToWav(
  pcmData: Buffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}

/**
 * Gemini TTS (gemini-2.5-flash-preview-tts).
 * Uses the same GEMINI_API_KEY that drives the AI assistant — no separate key needed.
 * Natively supports 100+ languages including Sinhala, Tamil, Hindi, English.
 * Returns a WAV buffer (PCM converted to WAV in-memory — no ffmpeg required).
 * Docs: https://ai.google.dev/gemini-api/docs/speech-generation
 */
async function ttsGemini(
  text: string,
  lang: string,
  voiceName: string,
): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY not configured');
  }

  // Map per-language default voices for natural accent/style
  const GEMINI_VOICE_DEFAULTS: Record<string, string> = {
    si: 'Sulafat', // Warm — closest to natural Sinhala cadence
    ta: 'Leda', // Youthful — good for Tamil
    hi: 'Achird', // Friendly — good for Hindi
    en: 'Kore', // Firm — clear English
  };
  const voice = voiceName || GEMINI_VOICE_DEFAULTS[lang] || 'Kore';

  console.log(
    `   🤖 Gemini TTS — model: gemini-2.5-flash-preview-tts, voice: ${voice}, lang: ${lang}`,
  );

  const payload = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  };

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      timeout: 30000,
    },
  );

  const pcmBase64: string | undefined =
    response.data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!pcmBase64) {
    throw new Error('Gemini TTS returned no audio data');
  }

  // Convert raw PCM → WAV so WhatsApp can play it
  const pcmBuffer = Buffer.from(pcmBase64, 'base64');
  const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);

  console.log(
    `   ✅ Gemini TTS: ${pcmBuffer.length} PCM bytes → ${wavBuffer.length} WAV bytes`,
  );
  return wavBuffer;
}

/**
 * Google Cloud Text-to-Speech (official REST API).
 * Requires a Google Cloud API key with "Cloud Text-to-Speech API" enabled.
 * Does NOT support Sinhala — call will throw for 'si'.
 */
async function ttsGoogleCloud(
  text: string,
  lang: string,
  apiKey: string,
): Promise<Buffer> {
  const voice = GOOGLE_CLOUD_VOICES[lang];
  if (!voice) {
    throw new Error(
      `Google Cloud TTS has no voice for language '${lang}'. Use Google Free for Sinhala.`,
    );
  }

  console.log(`   🎙️ Google Cloud TTS — voice: ${voice.name}, lang: ${lang}`);

  const payload = {
    input: { ssml: wrapSSML(text) },
    voice: {
      languageCode: voice.languageCode,
      name: voice.name,
      ssmlGender: voice.gender,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 0.95, // Slightly slower for clarity
      pitch: 2.0, // Slightly higher pitch for friendliness (+2 semitones)
      volumeGainDb: 1.0, // Small boost
      effectsProfileId: ['handset-class-device'], // Optimised for phone speakers
    },
  };

  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    payload,
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
  );

  if (!response.data?.audioContent) {
    throw new Error('Google Cloud TTS returned empty audioContent');
  }

  // audioContent is base64-encoded MP3
  return Buffer.from(response.data.audioContent, 'base64');
}

/**
 * OpenAI TTS (tts-1 / tts-1-hd).
 * Supports English best, can handle Tamil and Sinhala with accent.
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

  // 5. Google Free TTS — primary (when explicitly selected)
  if (primaryProvider === 'google-free') {
    waterfall.push({
      name: 'Google Free TTS (primary)',
      fn: () => ttsGoogleFree(text, lang),
    });
  }

  // ── Cascade fallbacks (providers not already in list) ─────────────────────────
  // Gemini TTS fallback — for ALL languages including Sinhala (most reliable, no per-lang limits)
  if (primaryProvider !== 'gemini-tts' && geminiApiKey) {
    waterfall.push({
      name: 'Gemini TTS (fallback)',
      fn: () => ttsGemini(text, lang, voiceId),
    });
  }

  // Google Cloud fallback — skip Sinhala
  if (primaryProvider !== 'google-cloud' && lang !== 'si' && googleApiKey) {
    waterfall.push({
      name: 'Google Cloud TTS (fallback)',
      fn: () => ttsGoogleCloud(text, lang, googleApiKey),
    });
  }

  // OpenAI fallback
  if (
    primaryProvider !== 'openai' &&
    primaryProvider !== 'elevenlabs' &&
    apiKey
  ) {
    waterfall.push({
      name: 'OpenAI TTS (fallback)',
      fn: () => ttsOpenAI(text, lang, apiKey, voiceId, model),
    });
  }

  // Google Free TTS — last resort when not already primary
  if (primaryProvider !== 'google-free') {
    waterfall.push({
      name: 'Google Free TTS (last resort)',
      fn: () => ttsGoogleFree(text, lang),
    });
  }

  // ── Execute waterfall ────────────────────────────────────────────────────────
  let lastError: Error | null = null;

  for (const step of waterfall) {
    try {
      console.log(`   ▶ Trying ${step.name}...`);
      const audio = await step.fn();

      if (!audio || audio.length < 100) {
        throw new Error(
          `${step.name} returned empty or too-small audio buffer`,
        );
      }

      console.log(`   ✅ TTS success via ${step.name} (${audio.length} bytes)`);
      return audio;
    } catch (err: any) {
      lastError = err;
      console.warn(
        `   ⚠️ ${step.name} failed: ${err.message}. Trying next provider...`,
      );
    }
  }

  throw new Error(
    `All TTS providers failed. Last error: ${lastError?.message || 'unknown'}`,
  );
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
