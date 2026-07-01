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
import { withTimeout } from './withTimeout';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const TIMEOUT = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 45000;

// Doc-confirmed OpenRouter audio slugs (env-overridable). whisper-1 covers
// ~99 languages incl. Sinhala; gpt-4o-mini-tts is the OpenAI-compatible TTS.
const STT_MODEL = process.env.OPENROUTER_STT_MODEL || 'openai/whisper-1';
const TTS_MODEL =
  process.env.OPENROUTER_TTS_MODEL || 'openai/gpt-4o-mini-tts-2025-12-15';

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
    return key && typeof key === 'string' && key.trim() ? key : null;
  } catch {
    return null;
  }
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

  const body: Record<string, unknown> = {
    input_audio: {
      data: audioBuffer.toString('base64'),
      format: mimeToFormat(mimeType),
    },
    model: STT_MODEL,
  };
  // ISO-639-1 hint improves accuracy; omit for auto-detect.
  if (language && /^[a-z]{2}$/i.test(language)) body.language = language;

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
  const text = String(res.data?.text || '').trim();
  // Throw (rather than return '') so the caller's waterfall logs a real
  // failure and deterministically moves to the next provider, instead of
  // silently treating "no transcript" like "OpenRouter not configured".
  if (!text) throw new Error('OpenRouter STT returned no text');
  return text;
}

/** Synthesize speech via OpenRouter's /audio/speech. Returns audio bytes. Throws on failure. */
export async function openrouterSpeak(
  text: string,
  voice?: string,
): Promise<Buffer> {
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) throw new Error('OpenRouter provider not configured');

  const body = {
    model: TTS_MODEL,
    input: text,
    voice: voice || process.env.OPENROUTER_TTS_VOICE || 'alloy',
    response_format: 'mp3',
  };
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
  return buf;
}
