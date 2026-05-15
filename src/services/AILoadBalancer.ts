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
import { ChatGPTSessionService } from './ChatGPTSessionService';
import { ClaudeSessionService } from './ClaudeSessionService';

import Config from '../models/Config';
import { createCompanyConfig } from '../config/companies';
import { configurationManager } from './ConfigurationManagerService';
import { conversationHistoryService } from './ConversationHistoryService';
import { knowledgeTrainingService } from './KnowledgeTrainingService';

// Default company for load balancer if not specified (legacy support)
const defaultConfig = createCompanyConfig('default');

// Cache configuration
const SERVICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache for AI providers

export class AILoadBalancer {
  private services: AIService[] = [];
  private userAssignments: Map<string, number>;
  // Note: conversationHistory is now managed by ConversationHistoryService (persistent)
  // This Map is kept for temporary caching during a single request
  private historyCache: Map<string, AIChatMessage[]>;
  private totalRequests = 0;

  // Cache for loaded services
  private lastServiceLoad = 0;
  private serviceLoadPromise: Promise<void> | null = null;

  // MEMORY LEAK FIX: Add limits and cleanup for caches
  private readonly MAX_HISTORY_CACHE_SIZE = 1000;
  private readonly MAX_USER_ASSIGNMENTS_SIZE = 5000;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.userAssignments = new Map();
    this.historyCache = new Map();

    // MEMORY LEAK FIX: Start periodic cleanup every 10 minutes
    this.cleanupInterval = setInterval(
      () => this.cleanupCaches(),
      10 * 60 * 1000,
    );
  }

  /**
   * MEMORY LEAK FIX: Periodic cleanup of oversized caches
   */
  private cleanupCaches(): void {
    // Cleanup historyCache if over limit
    if (this.historyCache.size > this.MAX_HISTORY_CACHE_SIZE) {
      // Remove oldest entries (first half of the limit)
      const keysToDelete = Array.from(this.historyCache.keys()).slice(
        0,
        this.historyCache.size - this.MAX_HISTORY_CACHE_SIZE / 2,
      );
      for (const key of keysToDelete) {
        this.historyCache.delete(key);
      }
      console.log(
        `🧹 AILoadBalancer: Cleaned ${keysToDelete.length} history cache entries`,
      );
    }

    // Cleanup userAssignments if over limit
    if (this.userAssignments.size > this.MAX_USER_ASSIGNMENTS_SIZE) {
      const keysToDelete = Array.from(this.userAssignments.keys()).slice(
        0,
        this.userAssignments.size - this.MAX_USER_ASSIGNMENTS_SIZE / 2,
      );
      for (const key of keysToDelete) {
        this.userAssignments.delete(key);
      }
      console.log(
        `🧹 AILoadBalancer: Cleaned ${keysToDelete.length} user assignment entries`,
      );
    }
  }

  /**
   * MEMORY LEAK FIX: Cleanup on shutdown
   */
  public shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.historyCache.clear();
    this.userAssignments.clear();
    this.services = [];
    console.log('🧹 AILoadBalancer: Shutdown cleanup completed');
  }

  private async loadServices(): Promise<void> {
    const now = Date.now();

    // Return cached services if still valid
    if (
      this.services.length > 0 &&
      now - this.lastServiceLoad < SERVICE_CACHE_TTL_MS
    ) {
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
          } else if (conf.providerType === 'openai-session') {
            // Unofficial ChatGPT session-based provider (fallback only)
            this.services.push(
              new ChatGPTSessionService({
                sessionToken: conf.apiKey,
                model: conf.aiModel,
                configId: String((conf as any)._id),
                providerType: 'openai-session',
              }),
            );
          } else if (conf.providerType === 'claude-session') {
            // Unofficial Claude session-based provider (fallback only)
            this.services.push(
              new ClaudeSessionService({
                sessionKey: conf.apiKey,
                organizationId: conf.value || undefined,
                model: conf.aiModel,
                configId: String((conf as any)._id),
                providerType: 'claude-session',
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

      // Sort by Priority (Cost/Speed) — official APIs first, session-based last (fallback only)
      const priorityMap: Record<string, number> = {
        GroqService: 1,
        GeminiService: 2,
        OpenRouterService: 3,
        OpenAIService: 4,
        ChatGPTSessionService: 90,
        ClaudeSessionService: 91,
      };
      this.services.sort(
        (a, b) =>
          (priorityMap[a.constructor.name] || 50) -
          (priorityMap[b.constructor.name] || 50),
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
    // Get knowledge base from training service (includes learned knowledge)
    const knowledgeBase =
      await knowledgeTrainingService.getKnowledgeBaseForAI();
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

    // Get history from persistent storage
    let history: AIChatMessage[] = [];

    // Try to get cached history first (for same-request optimization)
    const cachedHistory = this.historyCache.get(userId);
    if (cachedHistory) {
      history = cachedHistory;
    } else {
      // Get from persistent storage
      const persistedMessages =
        await conversationHistoryService.getHistory(userId);
      if (persistedMessages.length > 0) {
        history = persistedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
      } else {
        // Initialize with system prompt and examples
        history = await this.getInitialHistory();
        await conversationHistoryService.setInitialHistory(
          userId,
          history.map((h) => ({
            role: h.role,
            content: h.content,
            timestamp: new Date(),
          })),
        );
      }
      // Cache for this request
      this.historyCache.set(userId, history);
    }

    // Add user message to history
    history.push({ role: 'user', content: message });

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

        // Add assistant response to history
        history.push({ role: 'assistant', content: response });

        // Persist the new messages to database (fire and forget)
        conversationHistoryService
          .addMessage(userId, 'user', message)
          .catch((err) => {
            console.error('Failed to persist user message:', err);
          });
        conversationHistoryService
          .addMessage(userId, 'assistant', response)
          .catch((err) => {
            console.error('Failed to persist assistant message:', err);
          });

        // AUTO-LEARN from successful conversation (fire and forget)
        // Only learn if response is substantial (> 50 chars)
        if (response.length > 50 && message.length > 10) {
          knowledgeTrainingService
            .learnFromConversation(message, response, 0.7)
            .catch((err) => {
              // Silent fail - learning is optional
            });
        }

        // Update cache
        this.historyCache.set(userId, history);

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

        // Auto-disable session-based providers when their cookie expires
        if (error?.code === 'SESSION_EXPIRED' && (service as any).configId) {
          const cfgId = (service as any).configId as string;
          Config.updateOne(
            { _id: cfgId },
            {
              $set: {
                isActive: false,
                description:
                  'Auto-disabled: session token expired. Reconnect from Configuration page.',
              },
            },
          )
            .then(() => {
              this.lastServiceLoad = 0; // force reload on next request
              console.warn(
                `🔒 Auto-disabled ${service.name} (configId=${cfgId}) — session expired.`,
              );
            })
            .catch((e) => console.error('Failed to auto-disable provider:', e));
        }
      }
    }

    throw new Error('All AI services failed.');
  }

  /**
   * Raw send for the agent layer. Bypasses ConversationHistoryService
   * (agents manage their own history) and returns provider metadata so the
   * orchestrator can track budgets per execution. Respects provider/model
   * overrides — falls back to priority chain only if the requested provider
   * fails or isn't loaded.
   */
  async sendMessageRaw(options: {
    systemPrompt: string;
    userMessage: string;
    history?: AIChatMessage[];
    providerOverride?: string | null;
    modelOverride?: string | null;
  }): Promise<{
    text: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }> {
    await this.loadServices();
    if (this.services.length === 0) {
      throw new Error('No AI services configured');
    }

    const messages: AIChatMessage[] = [
      { role: 'system', content: options.systemPrompt },
      ...(options.history ?? []),
      { role: 'user', content: options.userMessage },
    ];

    const ordered = options.providerOverride
      ? [
          ...this.services.filter((s) =>
            s.constructor.name
              .toLowerCase()
              .includes((options.providerOverride ?? '').toLowerCase()),
          ),
          ...this.services.filter(
            (s) =>
              !s.constructor.name
                .toLowerCase()
                .includes((options.providerOverride ?? '').toLowerCase()),
          ),
        ]
      : this.services;

    let lastError: unknown = null;
    for (const service of ordered) {
      try {
        const start = Date.now();
        const text = await service.generateResponse(messages);
        const latencyMs = Date.now() - start;
        const inputLen = messages.reduce((a, m) => a + m.content.length, 0);
        const inputTokens = Math.ceil(inputLen / 4);
        const outputTokens = Math.ceil(text.length / 4);
        this.trackUsage(service.name, inputTokens, outputTokens);
        return {
          text,
          provider: service.name,
          inputTokens,
          outputTokens,
          latencyMs,
        };
      } catch (err) {
        lastError = err;
        console.error(`sendMessageRaw: ${service.name} failed:`, err);
      }
    }
    throw new Error(
      `sendMessageRaw: all providers failed (${
        lastError instanceof Error ? lastError.message : 'unknown'
      })`,
    );
  }

  async clearConversation(userId: string) {
    await conversationHistoryService.clearHistory(userId);
    this.historyCache.delete(userId);
    this.userAssignments.delete(userId);
    console.log(`🗑️ LoadBalancer: Cleared conversation for ${userId}`);
  }

  /**
   * Clear all conversation histories (persistent storage)
   */
  async clearAllConversations() {
    const count = await conversationHistoryService.clearAllHistories();
    this.historyCache.clear();
    this.userAssignments.clear();
    console.log(`🧹 LoadBalancer: Cleared all ${count} conversations.`);
    return count;
  }

  /**
   * Get conversation count for monitoring
   */
  async getConversationCount(): Promise<number> {
    return conversationHistoryService.getConversationCount();
  }

  /**
   * Get retention period in days
   */
  getRetentionDays(): number {
    return conversationHistoryService.getRetentionDays();
  }

  /**
   * Cleanup old conversations (now handled by MongoDB TTL index)
   */
  async cleanupOldConversations(): Promise<number> {
    // TTL index handles cleanup automatically
    // This method is kept for compatibility
    return 0;
  }

  getStats() {
    return {
      activeConversations: this.historyCache.size,
      activeUsers: this.userAssignments.size,
      servicesLoaded: this.services.length,
      totalRequests: this.totalRequests,
      lastServiceLoad: this.lastServiceLoad
        ? new Date(this.lastServiceLoad).toISOString()
        : null,
      serviceCacheValid:
        Date.now() - this.lastServiceLoad < SERVICE_CACHE_TTL_MS,
      retentionDays: this.getRetentionDays(),
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
