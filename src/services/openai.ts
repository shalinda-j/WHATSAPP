import OpenAI, { toFile } from 'openai';
import { AIService, AIChatMessage } from '../interfaces/AIService';
import { configService } from './ConfigService';

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
        const personality = await configService.getAIPersonality();
        const knowledgeBase = await configService.getDynamicKnowledgeBase();
        formattedMessages.unshift({
          role: 'system',
          content: `${personality}\n\n${knowledgeBase}`,
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
  apiKey: string,
): Promise<string> {
  try {
    const openai = new OpenAI({ apiKey });

    // We need to convert the Buffer into a File object that OpenAI API accepts
    // The toFile utility from openai package helps with this
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
