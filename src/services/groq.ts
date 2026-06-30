import OpenAI from 'openai';
import { AIService, AIChatMessage } from '../interfaces/AIService';
import { configService } from './ConfigService';
import { withTimeout } from './withTimeout';
import { coerceToSupportedGroqModel } from '../config/groqModels';

// Hard ceiling on any single Groq network call. Prevents a hung request
// from blocking the AILoadBalancer fallback chain indefinitely.
const TIMEOUT = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 45000;

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
    // Coerce blank / decommissioned models (e.g. the old 'mixtral-8x7b-32768'
    // default, which 404s on every call) to a current supported model. Groq is
    // priority 1 in the fallback chain, so a dead model here made the primary
    // provider fail on every message and constantly fall over to Gemini.
    this.modelName = coerceToSupportedGroqModel(config.model);
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
        const personality = await configService.getAIPersonality();
        const knowledgeBase = await configService.getDynamicKnowledgeBase();
        formattedMessages.unshift({
          role: 'system',
          content: `${personality}\n\n${knowledgeBase}`,
        });
      }

      // Call Groq API (using OpenAI SDK)
      const completion = await withTimeout(
        this.client.chat.completions.create(
          {
            messages: formattedMessages,
            model: this.modelName,
            temperature: 0.7,
            max_tokens: 2048,
          },
          { timeout: TIMEOUT },
        ),
        TIMEOUT,
        'groq',
      );

      return completion.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error(`GroqService (${this.modelName}) error:`, error);
      throw error;
    }
  }
}
