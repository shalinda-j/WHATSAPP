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
  // Resolve model + voice + key from the admin-configured 'openrouter-tts'
  // provider row (Add Model section), falling back to env/defaults.
  const settings = await getOpenRouterVoiceSettings();
  if (!settings.apiKey) throw new Error('OpenRouter provider not configured');

  const body = {
    model: settings.model,
    input: text,
    voice: voice || settings.voice,
    response_format: 'mp3',
  };
  const apiKey = settings.apiKey;
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
