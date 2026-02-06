import OpenAI, { toFile } from 'openai';
import { AIService, AIChatMessage } from '../interfaces/AIService';
import { AI_PERSONALITY, JOB_KNOWLEDGE_BASE } from '../config/ai-personality';

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
        formattedMessages.unshift({
          role: 'system',
          content: `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}`,
        });
      }

      const completion = await this.client.chat.completions.create({
        messages: formattedMessages,
        model: this.modelName,
      });

      return completion.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error(`OpenAIService (${this.modelName}) error:`, error);
      throw error;
    }
  }
}


/**
 * Transcribe audio using OpenAI Whisper
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  apiKey: string
): Promise<string> {
  try {
    const openai = new OpenAI({ apiKey });
    const file = await toFile(audioBuffer, 'voice_message.ogg', {
      type: 'audio/ogg',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
    });

    return transcription.text;
  } catch (error) {
    console.error('OpenAI Whisper transcription error:', error);
    throw error;
  }
}
