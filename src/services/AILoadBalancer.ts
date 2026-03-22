import { AIService, AIChatMessage } from '../interfaces/AIService';
import { GeminiService } from './gemini';
import {
  AI_PERSONALITY,
  JOB_KNOWLEDGE_BASE,
  getConversationExamples,
} from '../config/ai-personality';
import Dataset from '../models/Dataset';

import { OpenAIService } from './openai';
import { GroqService } from './groq';
import { OpenRouterService } from './openrouter';

import Config from '../models/Config';
import { createCompanyConfig } from '../config/companies';
import { configurationManager } from './ConfigurationManagerService';

// Default company for load balancer if not specified (legacy support)
const defaultConfig = createCompanyConfig('default');

// Cache configuration
const SERVICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache for AI providers

export class AILoadBalancer {
  private services: AIService[] = [];
  private userAssignments: Map<string, number>;
  private conversationHistory: Map<string, AIChatMessage[]>;
  private totalRequests = 0;

  // Cache for loaded services
  private lastServiceLoad: number = 0;
  private serviceLoadPromise: Promise<void> | null = null;

  constructor() {
    this.userAssignments = new Map();
    this.conversationHistory = new Map();
  }

  private async loadServices(): Promise<void> {
    const now = Date.now();

    // Return cached services if still valid
    if (this.services.length > 0 && now - this.lastServiceLoad < SERVICE_CACHE_TTL_MS) {
      return;
    }

    // If a load is already in progress, wait for it
    if (this.serviceLoadPromise) {
      return this.serviceLoadPromise;
    }

    // Start loading
    this.serviceLoadPromise = this._doLoadServices();

    try {
      await this.serviceLoadPromise;
    } finally {
      this.serviceLoadPromise = null;
    }
  }

  private async _doLoadServices(): Promise<void> {
    this.services = []; // Clear existing
    try {
      const configs = await Config.find({ isProvider: true, isActive: true });

      for (const conf of configs) {
        if (conf.apiKey) {
          if (conf.providerType === 'google') {
            this.services.push(
              new GeminiService({
                apiKey: conf.apiKey,
                model: conf.aiModel,
                providerType: 'google',
              }),
            );
          } else if (conf.providerType === 'openai') {
            this.services.push(
              new OpenAIService({
                apiKey: conf.apiKey,
                model: conf.aiModel,
                providerType: 'openai',
              }),
            );
          } else if (conf.providerType === 'groq') {
            this.services.push(
              new GroqService({
                apiKey: conf.apiKey,
                model: conf.aiModel,
                providerType: 'groq',
              }),
            );
          } else if (conf.providerType === 'openrouter') {
            this.services.push(
              new OpenRouterService({
                apiKey: conf.apiKey,
                model: conf.aiModel,
                providerType: 'openrouter',
              }),
            );
          }
          // Add other providers here (e.g. Anthropic)
        }
      }

      if (this.services.length === 0) {
        // Fallback to env if no DB config
        const envKey = process.env.GEMINI_API_KEY;
        if (envKey) {
          this.services.push(new GeminiService({ apiKey: envKey }));
          console.log(
            '⚠️ No active DB providers. Using env GEMINI_API_KEY backup.',
          );
        }
      }

      // Sort by Priority (Cost/Speed) - Groq > Google > OpenRouter > OpenAI
      const priorityMap: Record<string, number> = {
        GroqService: 1,
        GeminiService: 2,
        OpenRouterService: 3,
        OpenAIService: 4,
      };
      this.services.sort(
        (a, b) =>
          (priorityMap[a.constructor.name] || 99) -
          (priorityMap[b.constructor.name] || 99),
      );

      this.lastServiceLoad = Date.now();

      console.log(
        `🤖 Loaded ${this.services.length} AI services from DB. Primary: ${this.services[0]?.constructor.name}`,
      );
    } catch (err) {
      console.error('Failed to load AI services:', err);
    }
  }

  /**
   * Force reload of services (call when config is updated)
   */
  async forceReloadServices(): Promise<void> {
    this.lastServiceLoad = 0;
    await this.loadServices();
  }

  private async trackUsage(
    providerName: string,
    inputTokens: number,
    outputTokens: number,
  ) {
    try {
      // Extract model name from "Gemini (gemini-1.5-flash)" -> "gemini-1.5-flash"
      const modelMatch = providerName.match(/\((.*?)\)/);
      const modelName = modelMatch ? modelMatch[1] : '';

      // Determine provider type from service name
      let providerType = 'openai'; // default
      if (providerName.toLowerCase().includes('gemini')) {
        providerType = 'google';
      } else if (providerName.toLowerCase().includes('groq')) {
        providerType = 'groq';
      } else if (providerName.toLowerCase().includes('openrouter')) {
        providerType = 'openrouter';
      }

      if (modelName) {
        await Config.updateOne(
          { isProvider: true, providerType: providerType, aiModel: modelName },
          { $inc: { usageUsed: inputTokens + outputTokens } },
        );
      }
    } catch (err) {
      console.error('Failed to track usage:', err);
    }
  }

  private async getInitialHistory(): Promise<AIChatMessage[]> {
    const knowledgeBase = await configurationManager.getAIKnowledgeBase();
    const aiPersonality = await configurationManager.getAIPersonality();
    const conversationExamples = await getConversationExamples();

    const history: AIChatMessage[] = [
      {
        role: 'system',
        content: `${aiPersonality}\n\n${knowledgeBase}`,
      },
    ];

    for (const ex of conversationExamples) {
      history.push({ role: 'user', content: ex.user });
      history.push({ role: 'assistant', content: ex.assistant });
    }
    return history;
  }

  async sendMessage(userId: string, message: string): Promise<string> {
    // Load services with caching (not on every message)
    await this.loadServices();

    if (this.services.length === 0) {
      return '⚠️ No AI services are configured. Please check the Admin Panel.';
    }

    let history = this.conversationHistory.get(userId);
    if (!history) {
      history = await this.getInitialHistory();
      this.conversationHistory.set(userId, history);
    }

    conversationHistoryAdd(history, 'user', message);

    this.totalRequests++;

    // Try services in priority order
    for (let i = 0; i < this.services.length; i++) {
      const service = this.services[i];

      try {
        if (i > 0)
          console.log(
            `   ⚠️ Retrying with fallback: ${service.constructor.name}...`,
          );

        const start = Date.now();
        const response = await service.generateResponse(history);
        const duration = Date.now() - start;

        conversationHistoryAdd(history, 'assistant', response);

        // Trim history to prevent memory bloat (keep last 20 messages + system)
        if (history.length > 20) {
          const system = history[0];
          const recent = history.slice(-19);
          this.conversationHistory.set(userId, [system, ...recent]);
        }

        // TRACK USAGE
        // Estimate: 4 chars = 1 token
        const inputLen = history.reduce(
          (acc, msg) => acc + msg.content.length,
          0,
        );
        const outputLen = response.length;
        const inputTokens = Math.ceil(inputLen / 4);
        const outputTokens = Math.ceil(outputLen / 4);

        // Fire and forget usage tracking
        this.trackUsage(service.name, inputTokens, outputTokens);

        return response;
      } catch (error: any) {
        console.error(`   ❌ ${service.name} failed:`, error.message || error);
      }
    }

    throw new Error('All AI services failed.');
  }

  clearConversation(userId: string) {
    this.conversationHistory.delete(userId);
    this.userAssignments.delete(userId);
    console.log(`🗑️ LoadBalancer: Cleared conversation for ${userId}`);
  }

  /**
   * Clear all conversation histories (prevent memory leak)
   */
  clearAllConversations() {
    const count = this.conversationHistory.size;
    this.conversationHistory.clear();
    this.userAssignments.clear();
    console.log(`🧹 LoadBalancer: Cleared all ${count} conversations.`);
    return count;
  }

  /**
   * Get conversation count for monitoring
   */
  getConversationCount(): number {
    return this.conversationHistory.size;
  }

  /**
   * Cleanup old conversations (call periodically)
   * Removes conversations older than maxAgeMs
   */
  cleanupOldConversations(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    // Note: We don't track creation time, so this clears all
    // In a production system, you'd want to track last activity time
    const count = this.conversationHistory.size;
    if (count > 100) {
      // Only cleanup if there are many conversations
      this.conversationHistory.clear();
      this.userAssignments.clear();
      console.log(`🧹 LoadBalancer: Cleaned up ${count} old conversations.`);
      return count;
    }
    return 0;
  }

  getStats() {
    return {
      activeConversations: this.conversationHistory.size,
      activeUsers: this.userAssignments.size,
      servicesLoaded: this.services.length,
      totalRequests: this.totalRequests,
      lastServiceLoad: this.lastServiceLoad ? new Date(this.lastServiceLoad).toISOString() : null,
      serviceCacheValid: Date.now() - this.lastServiceLoad < SERVICE_CACHE_TTL_MS,
    };
  }
}

function conversationHistoryAdd(
  history: AIChatMessage[],
  role: 'user' | 'assistant',
  content: string,
) {
  // Avoid duplicates if we are retrying? No, we add once before loop.
  history.push({ role, content });
}

export const aiLoadBalancer = new AILoadBalancer();