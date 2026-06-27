import OpenAI, { toFile } from 'openai';
import { AIService, AIChatMessage } from '../interfaces/AIService';
import { AI_PERSONALITY, JOB_KNOWLEDGE_BASE } from '../config/ai-personality';
import { createCompanyConfig } from '../config/companies';
import { withTimeout } from './withTimeout';

// Hard ceiling on any single OpenAI network call. Prevents a hung request
// from blocking the AILoadBalancer fallback chain indefinitely.
const TIMEOUT = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 45000;

export class OpenAIService implements AIService {
  name: string;
  private client: OpenAI;
  private modelName: string;

  constructor(config: {
    apiKey: string;
    model?: string;
    providerType?: string;
  }) {
    this.modelName = config.model || 'gpt-4-turbo-preview';
    this.name = `OpenAI (${this.modelName})`;
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
  }

  async generateResponse(messages: AIChatMessage[]): Promise<string> {
    try {
      // Prepare messages
      const formattedMessages: any[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Ensure system message is present (if not in history, though it usually is)
      const hasSystem = formattedMessages.some((m) => m.role === 'system');
      if (!hasSystem) {
        const defaultConfig = createCompanyConfig('default');
        formattedMessages.unshift({
          role: 'system',
          content: `${AI_PERSONALITY(defaultConfig)}\n\n${JOB_KNOWLEDGE_BASE(
            defaultConfig,
          )}`,
        });
      }

      const completion = await withTimeout(
        this.client.chat.completions.create(
          {
            messages: formattedMessages,
            model: this.modelName,
          },
          { timeout: TIMEOUT },
        ),
        TIMEOUT,
        'openai',
      );

      return completion.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error(`OpenAIService (${this.modelName}) error:`, error);
      throw error;
    }
  }
}

/**
 * Map an audio MIME type to a Whisper-friendly file extension.
 * Whisper accepts: flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm.
 * Falls back to 'ogg' (the WhatsApp PTT default) for anything unrecognised.
 */
function mimeToAudioExt(mimeType?: string): string {
  if (!mimeType) return 'ogg';
  const m = mimeType.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'mp4';
  if (m.includes('wav') || m.includes('wave') || m.includes('x-wav'))
    return 'wav';
  if (m.includes('mpeg') || m.includes('mpga') || m.includes('mp3'))
    return 'mp3';
  return 'ogg';
}

/**
 * Transcribe audio using OpenAI Whisper.
 *
 * `mimeType` is optional and last so all existing callers keep working. When
 * provided it drives both the temp filename extension and the toFile `type`;
 * when omitted the previous behaviour (audio/ogg / voice_message.ogg) is kept
 * exactly.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  apiKey: string,
  mimeType?: string,
): Promise<string> {
  try {
    const openai = new OpenAI({ apiKey });

    // We need to convert the Buffer into a File object that OpenAI API accepts
    // The toFile utility from openai package helps with this
    const ext = mimeToAudioExt(mimeType);
    const file = await toFile(audioBuffer, `voice_message.${ext}`, {
      type: mimeType || 'audio/ogg',
    });

    const transcription = await withTimeout(
      openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
      }),
      TIMEOUT,
      'openai-transcribe',
    );

    return transcription.text;
  } catch (error) {
    console.error('OpenAI Whisper transcription error:', error);
    throw error;
  }
}
