import OpenAI from 'openai';
import { AIService, AIChatMessage } from '../interfaces/AIService';
import { AI_PERSONALITY, JOB_KNOWLEDGE_BASE } from '../config/ai-personality';

/**
 * OpenRouter AI Service
 * Provides access to 100+ AI models from multiple providers through a unified API
 *
 * Supported Providers: OpenAI, Anthropic, Google, Meta, Mistral, and more
 * API Documentation: https://openrouter.ai/docs
 *
 * Popular Models:
 * - openai/gpt-4o - Latest GPT-4
 * - anthropic/claude-3-opus - Claude 3 Opus
 * - google/gemini-pro - Gemini Pro
 * - meta-llama/llama-3-70b-instruct - Llama 3 70B
 */
export class OpenRouterService implements AIService {
  name: string;
  private client: OpenAI;
  private modelName: string;
  private appName?: string;
  private siteUrl?: string;

  constructor(config: {
    apiKey: string;
    model?: string;
    providerType?: string;
    appName?: string;
    siteUrl?: string;
  }) {
    this.modelName = config.model || 'openai/gpt-3.5-turbo';
    this.name = `OpenRouter (${this.modelName})`;
    this.appName = config.appName;
    this.siteUrl = config.siteUrl;

    // Initialize OpenAI client with OpenRouter base URL
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        // Optional: Include these headers to appear on OpenRouter leaderboards
        ...(this.siteUrl && { 'HTTP-Referer': this.siteUrl }),
        ...(this.appName && { 'X-Title': this.appName }),
      },
    });
  }

  async generateResponse(messages: AIChatMessage[]): Promise<string> {
    try {
      // Prepare messages for OpenRouter API
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

      // Call OpenRouter API (using OpenAI SDK)
      const completion = await this.client.chat.completions.create({
        messages: formattedMessages,
        model: this.modelName,
        temperature: 0.7,
        max_tokens: 2048,
      });

      return completion.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error(`OpenRouterService (${this.modelName}) error:`, error);

      // Provide helpful error messages
      if (error.status === 401) {
        throw new Error(
          'Invalid OpenRouter API key. Get your key at https://openrouter.ai/keys',
        );
      } else if (error.status === 402) {
        throw new Error(
          'Insufficient credits. Add credits at https://openrouter.ai/credits',
        );
      } else if (error.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      throw error;
    }
  }
}
