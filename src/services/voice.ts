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
import { openrouterTranscribe, openrouterSpeak } from './openrouterVoice';
import { getAudioUrl } from 'google-tts-api';
import OpenAI from 'openai';
import axios from 'axios';
import VoiceConfig from '../models/VoiceConfig';

// ── Language detection patterns ───────────────────────────────────────────────
const SINHALA_UNICODE_RANGE = /[\u0D80-\u0DFF]/;
const TAMIL_UNICODE_RANGE = /[\u0B80-\u0BFF]/;
const HINDI_UNICODE_RANGE = /[\u0900-\u097F]/;

const SINHALA_ROMANIZED_WORDS = [
  'mage',
  'nama',
  'mama',
  'oyata',
  'api',
  'kohomada',
  'kohomath',
  'honda',
  'neda',
  'neh',
  'enna',
  'matta',
  'pahada',
  'karanna',
  'balanna',
  'thiyenna',
  'ganna',
  'denna',
  'avilla',
  'yanna',
  'kale',
  'kota',
  'eta',
  'methana',
  'ethana',
  'aruwen',
  'karapu',
  'hithe',
  'theruma',
  'hithuna',
  'kiwwa',
  'katha',
  'karanawa',
  'balanawa',
  'thiyenawa',
  'gananawa',
  'mokada',
  'mokak',
  'kumana',
  'kawda',
  'kawuru',
  'etrin',
  'mehema',
  'ubata',
  'oba',
  'thamai',
  'wage',
  'witarai',
  'sambandha',
  'wadha',
  'pahath',
  'lokuya',
  'kudu',
  'narak',
  'sathutu',
  'duka',
  'katayuthu',
  'karadara',
  'sarpa',
  'ayubowan',
  'suba',
  'pathum',
  'nivasala',
  'gedara',
  'iskole',
  'kendaraya',
  'roshalaya',
  'asepasala',
];

const COMMON_ENGLISH_WORDS = new Set([
  'the',
  'is',
  'are',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'my',
  'your',
  'it',
  'and',
  'or',
  'but',
  'what',
  'how',
  'can',
  'could',
  'please',
  'hello',
  'hi',
  'thank',
  'thanks',
  'yes',
  'no',
  'okay',
  'ok',
  'not',
  'do',
  'does',
  'did',
  'will',
  'would',
  'should',
  'have',
  'has',
  'been',
  'was',
  'were',
  'am',
  'be',
  'being',
  'this',
  'that',
  'these',
  'those',
  'a',
  'an',
  'want',
  'need',
  'like',
  'know',
  'think',
  'see',
  'get',
  'make',
  'go',
  'come',
  'take',
  'give',
  'find',
  'tell',
  'ask',
  'work',
  'call',
  'try',
  'leave',
  'put',
  'mean',
  'keep',
  'let',
  'begin',
  'seem',
  'help',
  'show',
  'hear',
  'play',
  'run',
  'move',
  'live',
]);

// ── Language detection ─────────────────────────────────────────────────────────
export function detectLanguage(text: string): {
  lang: string;
  confidence: number;
} {
  const normalized = text.toLowerCase().trim();

  if (SINHALA_UNICODE_RANGE.test(text)) return { lang: 'si', confidence: 0.95 };
  if (TAMIL_UNICODE_RANGE.test(text)) return { lang: 'ta', confidence: 0.95 };
  if (HINDI_UNICODE_RANGE.test(text)) return { lang: 'hi', confidence: 0.95 };

  const words = normalized.split(/\s+/);
  let sinhalaCount = 0,
    englishCount = 0;

  for (const w of words) {
    if (SINHALA_ROMANIZED_WORDS.some((sw) => w.includes(sw) || sw.includes(w)))
      sinhalaCount++;
    if (COMMON_ENGLISH_WORDS.has(w)) englishCount++;
  }

  const total = Math.max(words.length, 1);
  const si = sinhalaCount / total;
  const en = englishCount / total;

  if (si > 0.15 && si >= en) return { lang: 'si', confidence: 0.7 + si * 0.2 };

  const isAscii =
    /^[a-zA-Z0-9\s\p{P}!?.,;&'"()+\-*#@%$^\[\]{}|\\/<>=`~]+$/u.test(normalized);
  if (isAscii && en > 0.1) return { lang: 'en', confidence: 0.8 + en * 0.15 };
  if (isAscii) return { lang: 'en', confidence: 0.5 };

  return { lang: 'si', confidence: 0.5 };
}

// ── Voice mode helpers ─────────────────────────────────────────────────────────
export async function getVoiceMode(): Promise<
  'voice-only' | 'text-only' | 'voice-and-text'
> {
  try {
    const c = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
    return c?.mode || 'voice-and-text';
  } catch {
    return 'voice-and-text';
  }
}

export async function isVoiceAgentEnabled(): Promise<boolean> {
  try {
    // Read the flag off the LATEST config row — do NOT filter by isActive.
    // Filtering by { isActive: true } made the disabled state unreachable:
    // when voice is toggled off (all rows isActive:false) the query returns
    // null and `null?.isActive ?? true` → true, so it reported enabled even
    // when disabled. Read the newest row and return its actual flag.
    const c = await VoiceConfig.findOne().sort({ updatedAt: -1 });
    return c?.isActive ?? true;
  } catch {
    return true;
  }
}

export async function getActiveVoiceConfig() {
  try {
    return await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
  } catch {
    return null;
  }
}

// ── Transcription ─────────────────────────────────────────────────────────────
export interface TranscriptionResult {
  text: string;
  detectedLanguage: string;
  languageConfidence: number;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType?: string,
): Promise<string> {
  const result = await transcribeAudioWithLanguage(audioBuffer, mimeType);
  return result.text;
}

export async function transcribeAudioWithLanguage(
  audioBuffer: Buffer,
  mimeType?: string,
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
      text = await openaiTranscribeAudio(audioBuffer, apiKey, mimeType);
      if (text)
        console.log(`   ✅ OpenAI Whisper: "${text.substring(0, 60)}..."`);
    } catch (err: any) {
      console.warn(`   ⚠️ OpenAI Whisper failed: ${err.message}`);
    }
  }

  // ── Step 1b: Try OpenRouter STT (multi-provider) ──────────────────────────
  // Uses the OpenRouter API key already configured for chat (Config provider),
  // so voice works with NO separate GEMINI_API_KEY / OPENAI_API_KEY. OpenRouter
  // routes to Whisper/Chirp/etc., covering Sinhala/Tamil/English. Skipped
  // silently when no OpenRouter provider is configured.
  if (!text) {
    try {
      console.log('   🎙️ Trying OpenRouter STT...');
      text = await openrouterTranscribe(audioBuffer, mimeType);
      if (text)
        console.log(`   ✅ OpenRouter STT: "${text.substring(0, 60)}..."`);
    } catch (err: any) {
      console.warn(`   ⚠️ OpenRouter STT failed: ${err?.message}`);
    }
  }

  // ── Step 2: Try Gemini audio transcription (primary free option) ───────────
  // Gemini 1.5 Flash supports audio/ogg natively (WhatsApp PTT format)
  if (!text) {
    try {
      console.log('   🎙️ Trying Gemini STT...');

      // Use the caller-supplied MIME type when provided (e.g. kiosk uploads:
      // audio/webm / audio/mp4 / audio/wav); otherwise default to audio/ogg
      // (WhatsApp PTT format) to preserve the previous behaviour exactly.
      text = await geminiTranscribeAudio(
        audioBuffer.toString('base64'),
        mimeType || 'audio/ogg',
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
  voiceId?: string,
): Promise<Buffer> {
  const voice = GOOGLE_CLOUD_VOICES[lang];
  if (!voice) {
    throw new Error(
      `Google Cloud TTS has no voice for language '${lang}'. Use Google Free for Sinhala.`,
    );
  }

  // Honour an operator-selected voice name from the Admin Panel (VoiceConfig
  // voiceId, e.g. "en-US-Neural2-F"). Falls back to our per-language default
  // when none is set. The languageCode is derived from the chosen voice name
  // (Google voice names are "<lang>-<region>-..." so the first two segments
  // give a valid BCP-47 code).
  const name = voiceId?.trim() || voice.name;
  const languageCode =
    voiceId?.trim() && name.split('-').length >= 2
      ? name.split('-').slice(0, 2).join('-')
      : voice.languageCode;

  console.log(`   🎙️ Google Cloud TTS — voice: ${name}, lang: ${lang}`);

  const payload = {
    input: { ssml: wrapSSML(text) },
    voice: {
      languageCode,
      name,
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
async function ttsOpenAI(
  text: string,
  lang: string,
  apiKey: string,
  voiceId: string,
  model: string,
): Promise<Buffer> {
  // Choose voice optimised for language
  const voiceMap: Record<string, string> = {
    en: voiceId || 'nova', // nova: warm female voice
    ta: voiceId || 'shimmer', // shimmer: gentle
    si: voiceId || 'alloy', // alloy: neutral
    hi: voiceId || 'nova',
  };
  const selectedVoice = voiceMap[lang] || voiceId || 'nova';

  console.log(
    `   🎙️ OpenAI TTS — model: ${model}, voice: ${selectedVoice}, lang: ${lang}`,
  );

  const client = new OpenAI({ apiKey });
  const mp3 = await client.audio.speech.create({
    model: (model as any) || 'tts-1',
    voice: selectedVoice as any,
    input: text,
    speed: 0.95, // Slightly slower for clarity
  });

  return Buffer.from(await mp3.arrayBuffer());
}

/**
 * ElevenLabs TTS.
 * Premium multilingual voice synthesis.
 */
async function ttsElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string,
  model: string,
): Promise<Buffer> {
  const vid = voiceId || 'pNInz6obpgDQGcFmaJcg'; // Default: Adam
  const mid = model || 'eleven_multilingual_v2';
  console.log(`   🎙️ ElevenLabs TTS — model: ${mid}, voice: ${vid}`);

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${vid}`,
    {
      text,
      model_id: mid,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        Accept: 'audio/mpeg',
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
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

  // Split on sentence boundaries into chunks that each fit under MAX. A single
  // sentence longer than MAX is HARD-SPLIT on word boundaries — otherwise
  // fetchGoogleFreeSegment truncates it at ~192 chars and silently drops the
  // tail of the speech.
  const sentences = text.split(/(?<=[.!?।෴ ]+)\s+/);
  const chunks: string[] = [];
  let chunk = '';
  const flush = () => {
    if (chunk.trim()) chunks.push(chunk.trim());
    chunk = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > MAX) {
      flush();
      let rest = sentence;
      while (rest.length > MAX) {
        let cut = rest.lastIndexOf(' ', MAX);
        if (cut <= 0) cut = MAX; // no space in range → hard cut
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      chunk = rest;
    } else if ((chunk + ' ' + sentence).length <= MAX) {
      chunk = chunk ? chunk + ' ' + sentence : sentence;
    } else {
      flush();
      chunk = sentence;
    }
  }
  flush();

  const segments: Buffer[] = [];
  for (const c of chunks) {
    try {
      segments.push(await fetchGoogleFreeSegment(c, langCode));
    } catch (e) {
      console.warn('   ⚠️ Google Free segment failed, skipping...');
    }
  }

  if (segments.length === 0)
    throw new Error('Google Free TTS: all segments failed');
  if (segments.length === 1) return segments[0];

  console.log(`   📦 Combining ${segments.length} audio segments...`);
  return Buffer.concat(segments);
}

async function fetchGoogleFreeSegment(
  text: string,
  lang: string,
): Promise<Buffer> {
  let t = text;
  if (t.length > 195) {
    t = t.substring(0, 192) + '...';
  }

  const url = getAudioUrl(t, {
    lang,
    slow: false,
    host: 'https://translate.google.com',
  });

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 10000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.data || response.data.byteLength < 100) {
    throw new Error(
      `Google Free TTS: empty response for segment "${t.substring(0, 30)}..."`,
    );
  }

  return Buffer.from(response.data);
}

// ─── Main generateSpeech with waterfall routing ────────────────────────────────

export async function generateSpeech(
  text: string,
  targetLanguage?: string,
  preferredProvider?: string,
): Promise<Buffer> {
  // Load voice config (DB-resilient). Select the newest ACTIVE config to
  // match every other reader in this module (getActiveVoiceConfig,
  // isVoiceAgentEnabled, transcribeAudioWithLanguage). The previous
  // unfiltered findOne().sort({updatedAt:-1}) grabbed the newest row
  // regardless of isActive, so saving a newer draft/disabled config while an
  // older active one still existed made TTS either throw "Voice Agent
  // Disabled" or synthesize with the draft's wrong provider/credentials.
  let config: import('../models/VoiceConfig').IVoiceConfig | null = null;
  try {
    config = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
    if (!config) {
      // No ACTIVE config. Distinguish "voice explicitly disabled" (a config
      // row exists but is inactive) from "never configured" (no rows at all):
      // the former must refuse synthesis; the latter falls back to free TTS.
      const anyConfig = await VoiceConfig.exists({});
      if (anyConfig) {
        throw new Error('Voice Agent Disabled');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Voice Agent Disabled') {
      throw err;
    }
    console.warn(
      '   ⚠️ VoiceConfig DB unavailable — using Google Free TTS defaults',
    );
  }

  const lang = targetLanguage || detectLanguage(text).lang;
  // When a per-call/per-request provider is supplied it LEADS the waterfall
  // (tried first), then we fall back to the normal configured order. Omitting
  // it preserves the previous behaviour exactly.
  const primaryProvider =
    (preferredProvider && preferredProvider.trim()) ||
    config?.provider ||
    'google-free';
  const googleApiKey =
    config?.googleApiKey || process.env.GOOGLE_TTS_API_KEY || '';
  const apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  const voiceId = config?.voiceId || '';
  const model = config?.ttsModel || 'tts-1';

  console.log(
    `   🔊 TTS request — primary: ${primaryProvider}, lang: ${lang}, text length: ${text.length}`,
  );

  // ── Build provider waterfall ─────────────────────────────────────────────────
  // Gemini TTS is the preferred first-choice for ALL languages (including Sinhala)
  // because it natively supports 100+ languages using the same GEMINI_API_KEY.
  // Sinhala-only note: Google Cloud TTS is still skipped for si (no native voice).

  const waterfall: Array<{ name: string; fn: () => Promise<Buffer> }> = [];

  // 0. OpenRouter TTS — primary if explicitly chosen. Uses the configured
  //    OpenRouter provider key (no separate key needed). Self-checks the key
  //    and throws when unavailable, so the waterfall simply moves on.
  if (
    primaryProvider === 'openrouter' ||
    primaryProvider === 'openrouter-tts'
  ) {
    waterfall.push({
      name: 'OpenRouter TTS (primary)',
      fn: () => openrouterSpeak(text),
    });
  }

  // 1. Gemini TTS — primary if explicitly chosen (highest quality, all languages incl. Sinhala)
  if (primaryProvider === 'gemini-tts' && geminiApiKey) {
    waterfall.push({
      name: 'Gemini TTS (primary)',
      fn: () => ttsGemini(text, lang, voiceId),
    });
  }

  // 2. Google Cloud TTS — primary (NOT for Sinhala — no native voice)
  if (primaryProvider === 'google-cloud' && lang !== 'si' && googleApiKey) {
    waterfall.push({
      name: 'Google Cloud TTS (primary)',
      fn: () => ttsGoogleCloud(text, lang, googleApiKey, voiceId),
    });
  }

  // 3. OpenAI TTS — primary
  if (primaryProvider === 'openai' && apiKey) {
    waterfall.push({
      name: 'OpenAI TTS (primary)',
      fn: () => ttsOpenAI(text, lang, apiKey, voiceId, model),
    });
  }

  // 4. ElevenLabs TTS — primary
  if (primaryProvider === 'elevenlabs' && apiKey) {
    waterfall.push({
      name: 'ElevenLabs TTS (primary)',
      fn: () => ttsElevenLabs(text, apiKey, voiceId, model),
    });
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
      fn: () => ttsGoogleCloud(text, lang, googleApiKey, voiceId),
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

  // OpenRouter TTS fallback — preferred over the low-quality free TTS whenever
  // an OpenRouter provider is configured. Self-checks the key (throws → next).
  if (
    primaryProvider !== 'openrouter' &&
    primaryProvider !== 'openrouter-tts'
  ) {
    waterfall.push({
      name: 'OpenRouter TTS (fallback)',
      fn: () => openrouterSpeak(text),
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
