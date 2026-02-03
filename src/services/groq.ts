import OpenAI from 'openai';
import { AIService, AIChatMessage } from '../interfaces/AIService';
import { AI_PERSONALITY, JOB_KNOWLEDGE_BASE } from '../config/ai-personality';

/**
 * Groq AI Service
 * Uses OpenAI SDK since Groq API is OpenAI-compatible
 * API Documentation: https://console.groq.com/docs/quickstart
 */
export class GroqService implements AIService {
  name: string;
  private client: OpenAI;
  private modelName: string;

  constructor(config: {
    apiKey: string;
    model?: string;
    providerType?: string;
  }) {
    this.modelName = config.model || 'mixtral-8x7b-32768';
    this.name = `Groq (${this.modelName})`;

    // Initialize OpenAI client with Groq base URL
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  async generateResponse(messages: AIChatMessage[]): Promise<string> {
    try {
      // Prepare messages for Groq API
      const formattedMessages: any[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Ensure system message is present
      const hasSystem = formattedMessages.some((m) => m.role === 'system');
      if (!hasSystem) {
        formattedMessages.unshift({
          role: 'system',
          content: `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}`,
        });
      }

      // Call Groq API (using OpenAI SDK)
      const completion = await this.client.chat.completions.create({
        messages: formattedMessages,
        model: this.modelName,
        temperature: 0.7,
        max_tokens: 2048,
      });

      return completion.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error(`GroqService (${this.modelName}) error:`, error);
      throw error;
    }
  }
}
