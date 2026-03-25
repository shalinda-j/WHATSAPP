/**
 * Voice Service — TTS (Text-to-Speech) + STT (Transcription)
 *
 * TTS Waterfall routing per language:
 *
 * English / Tamil:
 *   1. Google Cloud TTS  (official, Neural2 voices, requires API key)
 *   2. OpenAI TTS        (tts-1/tts-1-hd, requires API key)
 *   3. ElevenLabs        (premium, requires API key)
 *   4. Google Free TTS   (unofficial Google Translate, no API key, always last resort)
 *
 * Sinhala:
 *   1. Google Free TTS   (ONLY engine with native Sinhala support)
 *   2. OpenAI TTS        (accent but understands Sinhala text, fallback)
 *   — Google Cloud TTS is intentionally skipped for Sinhala (no native voice)
 */

import { transcribeAudio as openaiTranscribeAudio } from './openai';
import { transcribeAudio as geminiTranscribeAudio } from './gemini';
import { getAudioUrl } from 'google-tts-api';
import OpenAI from 'openai';
import axios from 'axios';
import VoiceConfig from '../models/VoiceConfig';

// ── Language detection patterns ───────────────────────────────────────────────
const SINHALA_UNICODE_RANGE = /[\u0D80-\u0DFF]/;
const TAMIL_UNICODE_RANGE   = /[\u0B80-\u0BFF]/;
const HINDI_UNICODE_RANGE   = /[\u0900-\u097F]/;

const SINHALA_ROMANIZED_WORDS = [
  'mage','nama','mama','oyata','api','kohomada','kohomath','honda','neda','neh',
  'enna','matta','pahada','karanna','balanna','thiyenna','ganna','denna','avilla',
  'yanna','kale','kota','eta','methana','ethana','aruwen','karapu','hithe',
  'theruma','hithuna','kiwwa','katha','karanawa','balanawa','thiyenawa','gananawa',
  'mokada','mokak','kumana','kawda','kawuru','etrin','mehema','ubata','oba',
  'thamai','wage','witarai','sambandha','wadha','pahath','lokuya','kudu',
  'narak','sathutu','duka','katayuthu','karadara','sarpa','ayubowan','suba',
  'pathum','nivasala','gedara','iskole','kendaraya','roshalaya','asepasala',
];

const COMMON_ENGLISH_WORDS = new Set([
  'the','is','are','i','you','he','she','we','they','my','your','it','and','or',
  'but','what','how','can','could','please','hello','hi','thank','thanks','yes',
  'no','okay','ok','not','do','does','did','will','would','should','have','has',
  'been','was','were','am','be','being','this','that','these','those','a','an',
  'want','need','like','know','think','see','get','make','go','come','take',
  'give','find','tell','ask','work','call','try','leave','put','mean','keep',
  'let','begin','seem','help','show','hear','play','run','move','live',
]);

// ── Language detection ─────────────────────────────────────────────────────────
export function detectLanguage(text: string): { lang: string; confidence: number } {
  const normalized = text.toLowerCase().trim();

  if (SINHALA_UNICODE_RANGE.test(text)) return { lang: 'si', confidence: 0.95 };
  if (TAMIL_UNICODE_RANGE.test(text))   return { lang: 'ta', confidence: 0.95 };
  if (HINDI_UNICODE_RANGE.test(text))   return { lang: 'hi', confidence: 0.95 };

  const words = normalized.split(/\s+/);
  let sinhalaCount = 0, englishCount = 0;

  for (const w of words) {
    if (SINHALA_ROMANIZED_WORDS.some(sw => w.includes(sw) || sw.includes(w))) sinhalaCount++;
    if (COMMON_ENGLISH_WORDS.has(w)) englishCount++;
  }

  const total = Math.max(words.length, 1);
  const si = sinhalaCount / total;
  const en = englishCount / total;

  if (si > 0.15 && si >= en) return { lang: 'si', confidence: 0.7 + si * 0.2 };

  const isAscii = /^[a-zA-Z0-9\s\p{P}!?.,;&'"()+\-*#@%$^\[\]{}|\\/<>=`~]+$/u.test(normalized);
  if (isAscii && en > 0.1) return { lang: 'en', confidence: 0.8 + en * 0.15 };
  if (isAscii) return { lang: 'en', confidence: 0.5 };

  return { lang: 'si', confidence: 0.5 };
}

// ── Voice mode helpers ─────────────────────────────────────────────────────────
export async function getVoiceMode(): Promise<'voice-only' | 'text-only' | 'voice-and-text'> {
  try {
    const c = await VoiceConfig.findOne({ isActive: true }).sort({ updatedAt: -1 });
    return c?.mode || 'voice-and-text';
  } catch { return 'voice-and-text'; }
}

export async function isVoiceAgentEnabled(): Promise<boolean> {
  try {
    const c = await VoiceConfig.findOne({ isActive: true }).sort({ updatedAt: -1 });
    return c?.isActive ?? true;
  } catch { return true; }
}

export async function getActiveVoiceConfig() {
  try {
    return await VoiceConfig.findOne({ isActive: true }).sort({ updatedAt: -1 });
  } catch { return null; }
}

// ── Transcription ─────────────────────────────────────────────────────────────
export interface TranscriptionResult {
  text: string;
  detectedLanguage: string;
  languageConfidence: number;
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const result = await transcribeAudioWithLanguage(audioBuffer);
  return result.text;
}

export async function transcribeAudioWithLanguage(audioBuffer: Buffer): Promise<TranscriptionResult> {
  try {
    let config = null;
    try { config = await VoiceConfig.findOne({ isActive: true }).sort({ updatedAt: -1 }); } catch {}
    const provider = config?.provider || 'google-free';

    let text = '';

    if ((provider === 'openai' || provider === 'google-cloud') && config?.apiKey) {
      try {
        console.log('   🎙️ Transcribing with OpenAI Whisper...');
        text = await openaiTranscribeAudio(audioBuffer, config.apiKey);
      } catch (err: any) {
        console.warn(`   ⚠️ OpenAI STT failed: ${err.message}. Falling back to Gemini...`);
      }
    }

    if (!text) {
      console.log('   🎙️ Transcribing with Gemini...');
      text = await geminiTranscribeAudio(audioBuffer.toString('base64'), 'audio/ogg');
    }

    const langResult = detectLanguage(text);
    console.log(`   🌐 Detected language: ${langResult.lang} (confidence: ${langResult.confidence.toFixed(2)})`);

    return { text, detectedLanguage: langResult.lang, languageConfidence: langResult.confidence };
  } catch (err: any) {
    console.error('❌ Transcription error:', err.message || err);
    throw new Error('Failed to transcribe audio');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TTS — Waterfall Provider System
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Google Cloud TTS voice names per language (Neural2 quality).
 * Sinhala is intentionally absent — Google Cloud has no Sinhala voice.
 */
const GOOGLE_CLOUD_VOICES: Record<string, { languageCode: string; name: string; gender: string }> = {
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
 * Google Cloud Text-to-Speech (official REST API).
 * Requires a Google Cloud API key with "Cloud Text-to-Speech API" enabled.
 * Does NOT support Sinhala — call will throw for 'si'.
 */
async function ttsGoogleCloud(text: string, lang: string, apiKey: string): Promise<Buffer> {
  const voice = GOOGLE_CLOUD_VOICES[lang];
  if (!voice) {
    throw new Error(`Google Cloud TTS has no voice for language '${lang}'. Use Google Free for Sinhala.`);
  }

  console.log(`   🎙️ Google Cloud TTS — voice: ${voice.name}, lang: ${lang}`);

  const payload = {
    input: { ssml: wrapSSML(text) },
    voice: { languageCode: voice.languageCode, name: voice.name, ssmlGender: voice.gender },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 0.95,   // Slightly slower for clarity
      pitch: 2.0,           // Slightly higher pitch for friendliness (+2 semitones)
      volumeGainDb: 1.0,    // Small boost
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
async function ttsOpenAI(text: string, lang: string, apiKey: string, voiceId: string, model: string): Promise<Buffer> {
  // Choose voice optimised for language
  const voiceMap: Record<string, string> = {
    en: voiceId || 'nova',     // nova: warm female voice
    ta: voiceId || 'shimmer',  // shimmer: gentle
    si: voiceId || 'alloy',    // alloy: neutral
    hi: voiceId || 'nova',
  };
  const selectedVoice = voiceMap[lang] || voiceId || 'nova';

  console.log(`   🎙️ OpenAI TTS — model: ${model}, voice: ${selectedVoice}, lang: ${lang}`);

  const client = new OpenAI({ apiKey });
  const mp3 = await client.audio.speech.create({
    model: (model as any) || 'tts-1',
    voice: selectedVoice as any,
    input: text,
    speed: 0.95,  // Slightly slower for clarity
  });

  return Buffer.from(await mp3.arrayBuffer());
}

/**
 * ElevenLabs TTS.
 * Premium multilingual voice synthesis.
 */
async function ttsElevenLabs(text: string, apiKey: string, voiceId: string, model: string): Promise<Buffer> {
  const vid = voiceId || 'pNInz6obpgDQGcFmaJcg'; // Default: Adam
  const mid = model || 'eleven_multilingual_v2';
  console.log(`   🎙️ ElevenLabs TTS — model: ${mid}, voice: ${vid}`);

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${vid}`,
    {
      text,
      model_id: mid,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
    },
    {
      headers: { Accept: 'audio/mpeg', 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 30000,
    },
  );

  return Buffer.from(response.data);
}

/**
 * Google Translate TTS (unofficial free endpoint).
 * The ONLY option for Sinhala. No API key required.
 * 200-char limit per request — long text is split into segments.
 */
async function ttsGoogleFree(text: string, lang: string): Promise<Buffer> {
  const langCode = GOOGLE_FREE_LANG_MAP[lang] || 'en';
  console.log(`   🗣️ Google Free TTS — lang: ${langCode} (${lang})`);

  const MAX = 180; // Safe limit

  if (text.length <= MAX) {
    return fetchGoogleFreeSegment(text, langCode);
  }

  // Split on sentence boundaries
  const sentences = text.split(/(?<=[.!?।෴ ]+)\s+/);
  const segments: Buffer[] = [];
  let chunk = '';

  for (const sentence of sentences) {
    if ((chunk + ' ' + sentence).length <= MAX) {
      chunk = chunk ? chunk + ' ' + sentence : sentence;
    } else {
      if (chunk) {
        try { segments.push(await fetchGoogleFreeSegment(chunk, langCode)); } catch (e) {
          console.warn('   ⚠️ Google Free segment failed, skipping...');
        }
      }
      chunk = sentence;
    }
  }

  if (chunk) {
    try { segments.push(await fetchGoogleFreeSegment(chunk, langCode)); } catch (e) {
      console.warn('   ⚠️ Google Free final segment failed');
    }
  }

  if (segments.length === 0) throw new Error('Google Free TTS: all segments failed');
  if (segments.length === 1) return segments[0];

  console.log(`   📦 Combining ${segments.length} audio segments...`);
  return Buffer.concat(segments);
}

async function fetchGoogleFreeSegment(text: string, lang: string): Promise<Buffer> {
  let t = text;
  if (t.length > 195) { t = t.substring(0, 192) + '...'; }

  const url = getAudioUrl(t, { lang, slow: false, host: 'https://translate.google.com' });

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });

  if (!response.data || response.data.byteLength < 100) {
    throw new Error(`Google Free TTS: empty response for segment "${t.substring(0, 30)}..."`);
  }

  return Buffer.from(response.data);
}

// ─── Main generateSpeech with waterfall routing ────────────────────────────────

export async function generateSpeech(text: string, targetLanguage?: string): Promise<Buffer> {
  // Load voice config (DB-resilient)
  let config: import('../models/VoiceConfig').IVoiceConfig | null = null;
  try {
    config = await VoiceConfig.findOne().sort({ updatedAt: -1 });
  } catch {
    console.warn('   ⚠️ VoiceConfig DB unavailable — using Google Free TTS defaults');
  }

  if (config && !config.isActive) {
    throw new Error('Voice Agent Disabled');
  }

  const lang = targetLanguage || detectLanguage(text).lang;
  const primaryProvider = config?.provider || 'google-free';
  const googleApiKey = config?.googleApiKey || process.env.GOOGLE_TTS_API_KEY || '';
  const apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
  const voiceId = config?.voiceId || '';
  const model = config?.ttsModel || 'tts-1';

  console.log(`   🔊 TTS request — primary: ${primaryProvider}, lang: ${lang}, text length: ${text.length}`);

  // ── Build provider waterfall ─────────────────────────────────────────────────
  // For Sinhala: Google Free MUST be first (only native Sinhala engine)
  // For other languages: respect the user's primary provider, then cascade down

  const waterfall: Array<{ name: string; fn: () => Promise<Buffer> }> = [];

  if (lang === 'si') {
    // Sinhala: Google Free first (only native support)
    waterfall.push({ name: 'Google Free (Sinhala)', fn: () => ttsGoogleFree(text, lang) });
    if (apiKey) {
      waterfall.push({ name: 'OpenAI (Sinhala fallback)', fn: () => ttsOpenAI(text, lang, apiKey, voiceId, model) });
    }
  } else {
    // Other languages: respect configured primary provider, then cascade
    if (primaryProvider === 'google-cloud' && googleApiKey) {
      waterfall.push({ name: 'Google Cloud TTS', fn: () => ttsGoogleCloud(text, lang, googleApiKey) });
    }
    if (primaryProvider === 'openai' && apiKey) {
      waterfall.push({ name: 'OpenAI TTS', fn: () => ttsOpenAI(text, lang, apiKey, voiceId, model) });
    }
    if (primaryProvider === 'elevenlabs' && apiKey) {
      waterfall.push({ name: 'ElevenLabs TTS', fn: () => ttsElevenLabs(text, apiKey, voiceId, model) });
    }

    // Add alternates not yet in the list (graceful fallbacks)
    if (primaryProvider !== 'google-cloud' && googleApiKey) {
      waterfall.push({ name: 'Google Cloud TTS (fallback)', fn: () => ttsGoogleCloud(text, lang, googleApiKey) });
    }
    if (primaryProvider !== 'openai' && apiKey && primaryProvider !== 'elevenlabs') {
      waterfall.push({ name: 'OpenAI TTS (fallback)', fn: () => ttsOpenAI(text, lang, apiKey, voiceId, model) });
    }
    if (primaryProvider !== 'elevenlabs' && apiKey && primaryProvider === 'openai') {
      // Skip ElevenLabs if OpenAI is primary (not configured for ElevenLabs)
    }

    // Google Free is always the last-resort fallback
    waterfall.push({ name: 'Google Free TTS (last resort)', fn: () => ttsGoogleFree(text, lang) });
  }

  // ── Execute waterfall ────────────────────────────────────────────────────────
  let lastError: Error | null = null;

  for (const step of waterfall) {
    try {
      console.log(`   ▶ Trying ${step.name}...`);
      const audio = await step.fn();

      if (!audio || audio.length < 100) {
        throw new Error(`${step.name} returned empty or too-small audio buffer`);
      }

      console.log(`   ✅ TTS success via ${step.name} (${audio.length} bytes)`);
      return audio;
    } catch (err: any) {
      lastError = err;
      console.warn(`   ⚠️ ${step.name} failed: ${err.message}. Trying next provider...`);
    }
  }

  throw new Error(`All TTS providers failed. Last error: ${lastError?.message || 'unknown'}`);
}
