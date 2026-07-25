/**
 * OpenRouter voice (STT + TTS) — lets the kiosk / voice pipeline use the SAME
 * OpenRouter provider the operator already configured for chat, instead of
 * requiring a separate GEMINI_API_KEY / OPENAI_API_KEY env var.
 *
 * OpenRouter added dedicated audio endpoints (2026):
 *   - STT:  POST https://openrouter.ai/api/v1/audio/transcriptions
 *           body { input_audio:{data:<base64>, format}, model, language? } -> { text }
 *   - TTS:  POST https://openrouter.ai/api/v1/audio/speech  (OpenAI-compatible)
 *           body { model, input, voice, response_format } -> raw audio bytes
 *
 * The API key is read from the Config collection (isProvider + providerType
 * 'openrouter'), whose `apiKey` field auto-decrypts via the model getter — the
 * exact same source AILoadBalancer uses for chat. So once an OpenRouter
 * provider is added in the admin panel, voice works with NO extra config.
 *
 * Models are overridable via env; the defaults are the doc-confirmed OpenRouter
 * audio slugs (https://openrouter.ai/docs) that cover Sinhala/Tamil/English:
 *   OPENROUTER_STT_MODEL (default openai/whisper-1 — ~99 languages)
 *   OPENROUTER_TTS_MODEL (default openai/gpt-4o-mini-tts-2025-12-15 — OpenAI-compatible)
 */
import axios from 'axios';
import Config from '../models/Config';
import VoiceConfig from '../models/VoiceConfig';
import { withTimeout } from './withTimeout';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const TIMEOUT = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 45000;

// Doc-confirmed OpenRouter audio slugs (env-overridable). whisper-1 covers
// ~99 languages incl. Sinhala; gpt-4o-mini-tts is the OpenAI-compatible TTS.
const STT_MODEL = process.env.OPENROUTER_STT_MODEL || 'openai/whisper-1';
// Clean, un-dated slug. The previous default carried a '-2025-12-15' date
// suffix that OpenRouter rejects with 400 (model not found), which made the
// kiosk TTS silently fall back to robotic Google Free TTS on every turn.
const TTS_MODEL = process.env.OPENROUTER_TTS_MODEL || 'openai/gpt-4o-mini-tts';

/** The active OpenRouter provider's API key from Config, or null when none. */
export async function getOpenRouterApiKey(): Promise<string | null> {
  try {
    const conf = await Config.findOne({
      isProvider: true,
      isActive: true,
      providerType: 'openrouter',
    });
    // `apiKey` decrypts via the schema getter (same as AILoadBalancer).
    const key = (conf as unknown as { apiKey?: string } | null)?.apiKey;
    if (key && typeof key === 'string' && key.trim()) return key;
  } catch {
    /* fall through to env */
  }
  // Fall back to the OPENROUTER_API_KEY env var — the SAME failover source the
  // chat load-balancer uses. Without this, a deployment that configures
  // OpenRouter only via env (no admin provider row) had chat working but voice
  // TTS silently falling back to Google, because this lookup was DB-only.
  const envKey = process.env.OPENROUTER_API_KEY;
  return envKey && envKey.trim() && !/^your_.*_here$/i.test(envKey.trim())
    ? envKey.trim()
    : null;
}

/**
 * Resolve the TTS model + voice + key for OpenRouter speech synthesis.
 *
 * Precedence (so the operator can configure OpenRouter TTS entirely from the
 * dashboard WITHOUT touching env or code):
 *   1. The active Voice Provider row (VoiceConfig provider='openrouter'):
 *        ttsModel -> model, voiceId -> voice, apiKey -> key. This is what the
 *        "Voice Provider → OpenRouter" card writes, so picking OpenRouter as the
 *        voice provider and typing a model/voice there Just Works.
 *   2. A legacy Config provider row of type 'openrouter-tts' (Add Model):
 *        aiModel -> model, value -> voice, apiKey -> key.
 *   3. env OPENROUTER_TTS_MODEL / OPENROUTER_TTS_VOICE.
 *   4. Built-in defaults.
 * The key falls back to the chat OpenRouter provider's key when neither carries
 * its own, so adding just a model is enough.
 */
// OpenAI-native TTS slugs — if one leaks in as an OpenRouter model (e.g. the
// VoiceConfig schema default 'tts-1'), ignore it: OpenRouter needs a namespaced
// slug like 'openai/gpt-4o-mini-tts' and would 400 on a bare 'tts-1'.
const OPENAI_NATIVE_TTS = new Set(['tts-1', 'tts-1-hd']);

export async function getOpenRouterVoiceSettings(): Promise<{
  apiKey: string | null;
  model: string;
  voice: string;
}> {
  // 1. Active Voice Provider row (the "OpenRouter" voice card).
  let vcModel: string | undefined;
  let vcVoice: string | undefined;
  let vcKey: string | undefined;
  try {
    const vc = await VoiceConfig.findOne({
      isActive: true,
      provider: 'openrouter',
    }).sort({ updatedAt: -1 });
    // apiKey decrypts via the schema getter (same as elsewhere).
    const v = vc as unknown as {
      ttsModel?: string;
      voiceId?: string;
      apiKey?: string;
    } | null;
    const m = v?.ttsModel?.trim();
    vcModel = m && !OPENAI_NATIVE_TTS.has(m) ? m : undefined;
    vcVoice = v?.voiceId?.trim() || undefined;
    vcKey = v?.apiKey?.trim() || undefined;
  } catch {
    /* fall through to the legacy row / env / defaults */
  }

  // 2. Legacy 'openrouter-tts' Config provider row (Add Model section).
  let rowModel: string | undefined;
  let rowVoice: string | undefined;
  let rowKey: string | undefined;
  try {
    const ttsRow = await Config.findOne({
      isProvider: true,
      isActive: true,
      providerType: 'openrouter-tts',
    });
    const r = ttsRow as unknown as {
      aiModel?: string;
      value?: string;
      apiKey?: string;
    } | null;
    rowModel = r?.aiModel?.trim() || undefined;
    rowVoice = r?.value?.trim() || undefined;
    rowKey = r?.apiKey?.trim() || undefined;
  } catch {
    /* fall through to env/defaults */
  }

  const apiKey = vcKey || rowKey || (await getOpenRouterApiKey());
  return {
    apiKey: apiKey || null,
    model: vcModel || rowModel || TTS_MODEL,
    voice: vcVoice || rowVoice || process.env.OPENROUTER_TTS_VOICE || 'alloy',
  };
}

export function isOpenRouterVoiceAvailable(): Promise<boolean> {
  return getOpenRouterApiKey().then((k) => Boolean(k));
}

/** Map an incoming MIME type to OpenRouter's `format` field. */
function mimeToFormat(mime?: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('flac')) return 'flac';
  if (m.includes('aac')) return 'aac';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  return 'ogg'; // WhatsApp PTT default
}

/** Transcribe audio via OpenRouter's /audio/transcriptions. Throws on failure. */
export async function openrouterTranscribe(
  audioBuffer: Buffer,
  mimeType?: string,
  language?: string,
): Promise<string> {
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) throw new Error('OpenRouter provider not configured');
  const base64 = audioBuffer.toString('base64');
  const format = mimeToFormat(mimeType);

  const attempt = async (lang?: string): Promise<string> => {
    const body: Record<string, unknown> = {
      input_audio: { data: base64, format },
      model: STT_MODEL,
    };
    if (lang && /^[a-z]{2}$/i.test(lang)) body.language = lang;
    const res = await withTimeout(
      axios.post(`${OPENROUTER_BASE}/audio/transcriptions`, body, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT,
      }),
      TIMEOUT,
      'openrouter-stt',
    );
    return String(res.data?.text || '').trim();
  };

  let text = '';
  try {
    text = await attempt(language);
  } catch (err) {
    // Some languages aren't accepted by the whisper provider (e.g. 'si' → 400).
    // Retry once WITHOUT the hint (auto-detect) so a bad hint never blanks the
    // transcript. Only retry when a hint was actually set.
    if (language) {
      console.warn(
        `   ⚠️ OpenRouter STT with language='${language}' failed; retrying auto-detect.`,
      );
      text = await attempt(undefined);
    } else {
      throw err;
    }
  }
  // Throw (rather than return '') so the caller's waterfall logs a real
  // failure and deterministically moves to the next provider, instead of
  // silently treating "no transcript" like "OpenRouter not configured".
  if (!text) throw new Error('OpenRouter STT returned no text');
  return text;
}

// OpenAI /audio/speech voice ids. A Gemini TTS model rejects these (and vice
// versa), which is the real cause of the kiosk's 400s: the saved voice was the
// OpenAI default 'alloy' while the model was a Gemini TTS model.
const OPENAI_TTS_VOICES = new Set([
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
  'ash',
  'ballad',
  'coral',
  'sage',
  'verse',
]);
// Warm, multilingual Gemini voice (covers Sinhala/Tamil/Hindi) — the one the
// Gemini TTS card recommends. Used when a Gemini model has no valid voice set.
const GEMINI_DEFAULT_VOICE = 'Sulafat';

/** True for Google Gemini text-to-speech models (e.g. gemini-3.1-flash-tts). */
function isGeminiTtsModel(model: string): boolean {
  return /gemini/i.test(model) && /tts/i.test(model);
}

/**
 * Wrap raw little-endian PCM16 samples in a minimal 44-byte WAV header so a
 * browser <audio>/AudioContext can play them. Gemini TTS (via OpenRouter's
 * `response_format:"pcm"`) returns headerless PCM at 24 kHz, 16-bit, mono.
 */
function pcm16ToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Pick a voice that's valid for the model's family so OpenRouter doesn't 400 on
 * a cross-family voice id. Gemini TTS models use capitalised names (Sulafat,
 * Kore, Puck, …); OpenAI TTS models use lowercase ids (alloy, nova, …).
 */
function voiceForModel(model: string, configured?: string): string {
  const v = (configured || '').trim();
  const isGeminiTts = /gemini/i.test(model) && /tts/i.test(model);
  if (isGeminiTts) {
    // Empty or an OpenAI voice (e.g. the default 'alloy') → use a Gemini voice.
    if (!v || OPENAI_TTS_VOICES.has(v.toLowerCase()))
      return GEMINI_DEFAULT_VOICE;
    return v;
  }
  // OpenAI-style TTS: require an OpenAI voice; otherwise default to alloy.
  if (!v || !OPENAI_TTS_VOICES.has(v.toLowerCase())) return 'alloy';
  return v;
}

/** Synthesize speech via OpenRouter's /audio/speech. Returns audio bytes. Throws on failure. */
export async function openrouterSpeak(
  text: string,
  voice?: string,
): Promise<Buffer> {
  // Resolve model + voice + key from the active Voice Provider row (or the
  // legacy openrouter-tts row / env / defaults).
  const settings = await getOpenRouterVoiceSettings();
  if (!settings.apiKey) throw new Error('OpenRouter provider not configured');

  const model = settings.model;
  const isGemini = isGeminiTtsModel(model);
  // Auto-correct the voice to the model's family so a saved 'alloy' on a Gemini
  // model (the field bug) doesn't 400.
  const chosenVoice = voiceForModel(model, voice || settings.voice);
  // Gemini TTS on OpenRouter ONLY accepts response_format="pcm" (raw 24kHz/16-bit
  // mono) — asking for mp3 returns 400. OpenAI-style models keep mp3.
  const responseFormat = isGemini ? 'pcm' : 'mp3';
  const body = {
    model,
    input: text,
    voice: chosenVoice,
    response_format: responseFormat,
  };
  const apiKey = settings.apiKey;
  try {
    const res = await withTimeout(
      axios.post(`${OPENROUTER_BASE}/audio/speech`, body, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: TIMEOUT,
      }),
      TIMEOUT,
      'openrouter-tts',
    );
    const buf = Buffer.from(res.data);
    if (!buf.length) throw new Error('OpenRouter TTS returned empty audio');
    // Gemini returns headerless PCM — wrap it in a WAV container so the kiosk
    // browser can play it (detectAudioMime sees RIFF/WAVE → audio/wav).
    return isGemini ? pcm16ToWav(buf) : buf;
  } catch (err: unknown) {
    // Surface OpenRouter's REAL reason. The response is an arraybuffer (we
    // asked for one), so an error body arrives as bytes — decode it to text so
    // the log shows the actual message (bad model slug, unsupported endpoint,
    // invalid voice, no credits, …) instead of a bare "status code 400".
    const e = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    let detail = e?.message || 'unknown error';
    const data = e?.response?.data;
    if (data) {
      try {
        const s = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf8')
            : typeof data === 'string'
              ? data
              : JSON.stringify(data);
        if (s && s.trim()) detail = s.slice(0, 600);
      } catch {
        /* keep the message-based detail */
      }
    }
    console.warn(
      `   ⚠️ OpenRouter TTS ${e?.response?.status ?? ''} — model="${model}" voice="${chosenVoice}": ${detail}`,
    );
    throw err instanceof Error ? err : new Error(detail);
  }
}
