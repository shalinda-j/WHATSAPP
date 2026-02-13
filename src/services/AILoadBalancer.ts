import { AIService, AIChatMessage } from '../interfaces/AIService';
import { GeminiService } from './gemini';
import {
  AI_PERSONALITY,
  JOB_KNOWLEDGE_BASE,
  CONVERSATION_EXAMPLES,
} from '../config/ai-personality';
import Dataset from '../models/Dataset';

import { OpenAIService } from './openai';
import { GroqService } from './groq';
import { OpenRouterService } from './openrouter';

import Config from '../models/Config';
import { createCompanyConfig } from '../config/companies';

// Default company for load balancer if not specified (legacy support)
const defaultConfig = createCompanyConfig('default');

export class AILoadBalancer {
  private services: AIService[] = [];
  private userAssignments: Map<string, number>;
  private conversationHistory: Map<string, AIChatMessage[]>;
  private totalRequests = 0;

  constructor() {
    this.userAssignments = new Map();
    this.conversationHistory = new Map();
  }

  private async loadServices(): Promise<void> {
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

      console.log(`🤖 Loaded ${this.services.length} AI services from DB.`);
    } catch (err) {
      console.error('Failed to load AI services:', err);
    }
  }

  private async trackUsage(
    providerName: string,
    inputTokens: number,
    outputTokens: number,
  ) {
    try {
      // Find config by parsing name "Gemini (model-name)" or better, match strictly.
      // Simplified: update all configs that match strict criteria?
      // Better: LoadBalancer should know the Config ID.
      // For now, let's find the config that corresponds to the service.
      // This is imperfect if multiple configs use same model/key, but good enough.
      // Optimization: Update based on provider/model.

      // Heuristic for token matching
      const total = inputTokens + outputTokens;
      // Config update: increment usageUsed

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
          { $inc: { usageUsed: total } },
        );
      }
    } catch (err) {
      console.error('Failed to track usage:', err);
    }
  }

  private async getInitialHistory(): Promise<AIChatMessage[]> {
    let knowledgeBase = JOB_KNOWLEDGE_BASE(defaultConfig);
    try {
      const datasets = await Dataset.find({ isActive: true });
      if (datasets.length > 0) {
        const combinedData = datasets
          .map((ds) => ds.content)
          .join('\n\n---\n\n');
        knowledgeBase = `\n# 🌍 Knowledge Base (Dynamic)\n${combinedData}\n`;
      }
    } catch (err) {
      console.error('Dataset load error:', err);
    }

    const history: AIChatMessage[] = [
      {
        role: 'system',
        content: `${AI_PERSONALITY(defaultConfig)}\n\n${knowledgeBase}`,
      },
    ];

    for (const ex of CONVERSATION_EXAMPLES) {
      history.push({ role: 'user', content: ex.user });
      history.push({ role: 'assistant', content: ex.assistant });
    }
    return history;
  }

  async sendMessage(userId: string, message: string): Promise<string> {
    // ALWAYS reload services to capture config changes (or use cache with TTL, but immediate is better for debugging)
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

    let currentServiceIndex = this.userAssignments.get(userId);
    if (
      currentServiceIndex === undefined ||
      currentServiceIndex >= this.services.length
    ) {
      currentServiceIndex = this.totalRequests % this.services.length;
      this.userAssignments.set(userId, currentServiceIndex);
      this.totalRequests++;
    }

    // Try services
    for (let i = 0; i < this.services.length; i++) {
      const serviceIndex = (currentServiceIndex + i) % this.services.length;
      const service = this.services[serviceIndex];

      try {
        if (i > 0) console.log(`   ⚠️ Retrying with ${service.name}...`);

        const start = Date.now();
        const response = await service.generateResponse(history);
        const duration = Date.now() - start;

        conversationHistoryAdd(history, 'assistant', response);

        // Trim history
        if (history.length > 20) {
          const system = history[0];
          const recent = history.slice(-19);
          this.conversationHistory.set(userId, [system, ...recent]);
        }

        if (i > 0) {
          this.userAssignments.set(userId, serviceIndex);
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

  getStats() {
    return {
      activeConversations: this.conversationHistory.size,
      activeUsers: this.userAssignments.size,
      servicesLoaded: this.services.length,
      totalRequests: this.totalRequests,
    };
  }

  clearAllConversations() {
    const count = this.conversationHistory.size;
    this.conversationHistory.clear();
    this.userAssignments.clear();
    console.log(`🧹 LoadBalancer: Cleared all ${count} conversations.`);
    return count;
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
