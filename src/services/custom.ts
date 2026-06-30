import OpenAI from 'openai';
import { AIService, AIChatMessage } from '../interfaces/AIService';
import { configService } from './ConfigService';
import { withTimeout } from './withTimeout';

// Hard ceiling on any single Custom-provider network call, matching the
// openai/groq/openrouter services. Custom endpoints are the most likely to be
// a flaky self-hosted box (Ollama/LM Studio/vLLM); without this the OpenAI
// SDK's 10-minute default applies and the socket leaks long after the
// AILoadBalancer's outer timeout has already moved on to the next provider.
const TIMEOUT = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 45000;

/**
 * CustomAIService — connect ANY OpenAI-compatible chat endpoint.
 *
 * Works with anything that speaks the OpenAI Chat Completions spec:
 *   • Self-hosted: Ollama, LM Studio, vLLM, LocalAI, text-generation-webui
 *   • Hosted: Together.ai, DeepInfra, Fireworks, Mistral, DeepSeek, xAI Grok,
 *     Anyscale, Perplexity, or any private gateway.
 *
 * The operator supplies the base URL + API key + model name in
 * Admin Panel → Configuration → AI Providers (provider type "Custom").
 * This is the escape hatch from being locked to the few hardcoded providers —
 * and the practical fix when a free provider's quota runs out.
 */
export class CustomAIService implements AIService {
  name: string;
  /** Config _id this service was constructed from, for accurate usage tracking. */
  configId?: string;
  private client: OpenAI;
  private modelName: string;

  constructor(config: {
    apiKey: string;
    baseUrl: string;
    model?: string;
    providerType?: string;
    configId?: string;
  }) {
    if (!config.baseUrl) {
      throw new Error(
        'CustomAIService requires a baseUrl (the OpenAI-compatible endpoint).',
      );
    }
    this.configId = config.configId;
    this.modelName = config.model || 'gpt-3.5-turbo';
    // Show the host so multiple custom providers are distinguishable in logs.
    let host = config.baseUrl;
    try {
      host = new URL(config.baseUrl).host;
    } catch {
      /* keep raw string if not a full URL */
    }
    this.name = `Custom (${host} · ${this.modelName})`;

    this.client = new OpenAI({
      apiKey: config.apiKey || 'not-needed',
      baseURL: config.baseUrl.replace(/\/+$/, ''), // trim trailing slash(es)
    });
  }

  async generateResponse(messages: AIChatMessage[]): Promise<string> {
    try {
      const formattedMessages: any[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Ensure a system prompt is present (same contract as the other services).
      const hasSystem = formattedMessages.some((m) => m.role === 'system');
      if (!hasSystem) {
        const personality = await configService.getAIPersonality();
        const knowledgeBase = await configService.getDynamicKnowledgeBase();
        formattedMessages.unshift({
          role: 'system',
          content: `${personality}\n\n${knowledgeBase}`,
        });
      }

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
        'custom',
      );

      return completion.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error(`CustomAIService (${this.name}) error:`, error?.message);

      if (error?.status === 401 || error?.status === 403) {
        throw new Error(
          'Custom provider rejected the API key (401/403). Check the key in Admin Panel > Configuration.',
        );
      } else if (error?.status === 404) {
        throw new Error(
          'Custom provider endpoint or model not found (404). Verify the Base URL and Model Name.',
        );
      } else if (error?.status === 429) {
        throw new Error(
          'Custom provider rate limit exceeded. Try again later.',
        );
      } else if (
        error?.code === 'ECONNREFUSED' ||
        error?.code === 'ENOTFOUND' ||
        /fetch failed|network/i.test(error?.message || '')
      ) {
        throw new Error(
          'Could not reach the custom provider Base URL. Is the endpoint online and reachable from the server?',
        );
      }
      throw error;
    }
  }
}
