import { AIService, AIChatMessage } from '../interfaces/AIService';
import { GeminiService } from './gemini';
import { withTimeout } from './withTimeout';
import {
  AI_PERSONALITY,
  JOB_KNOWLEDGE_BASE,
  getConversationExamples,
} from '../config/ai-personality';

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Response Post-Processor
//
// Enforces short, conversion-focused messages every time — regardless of which
// AI provider replied. Rules applied in order:
//  1. Fix markdown syntax that WhatsApp renders literally (**, ##, __).
//  2. Collapse bullet / numbered lists into flowing prose.
//  3. Cap at MAX_WHATSAPP_PARAGRAPHS paragraph blocks.
//  4. Emergency hard-cap at MAX_WHATSAPP_CHARS characters.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_WHATSAPP_PARAGRAPHS = 3;
const MAX_WHATSAPP_CHARS = 700;

/**
 * Cleans and trims an AI response so it fits WhatsApp's conversational style:
 * short, plain-text, single CTA.
 *
 * NOTE: This is the last line of defence. The AI personality prompt should
 * already instruct the model to stay under 4 sentences — this function is the
 * hard guarantee that fires only when the model ignores those instructions.
 */
export function enforceWhatsAppStyle(raw: string): string {
  // 1. Fix markdown that renders as literal symbols in WhatsApp
  let text = raw
    // **bold** → *bold*  (WhatsApp uses single asterisk)
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    // ### Heading → plain text
    .replace(/^#{1,6}\s+/gm, '')
    // --- / *** / ___ horizontal rules → remove
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // - bullet / * bullet → plain line (keep the text)
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    // 1. numbered list → plain line
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    // __underline__ → plain
    .replace(/__([^_\n]+)__/g, '$1')
    // Collapse 3+ blank lines → single blank line
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 2. If already short enough, return immediately
  if (text.length <= 400) return text;

  // 3. Try paragraph-level cap (each \n\n is a "block")
  const blocks = text.split(/\n\n+/);
  if (blocks.length > MAX_WHATSAPP_PARAGRAPHS) {
    // Keep only the first N paragraphs, making sure we always keep the last
    // block IF it contains a CTA command (!register / !book).
    const kept = blocks.slice(0, MAX_WHATSAPP_PARAGRAPHS);
    const lastBlock = blocks[blocks.length - 1];
    const lastHasCta = /!\w+/.test(lastBlock);
    if (lastHasCta && !kept.includes(lastBlock)) {
      kept[kept.length - 1] = lastBlock; // replace last kept block with CTA block
    }
    text = kept.join('\n\n').trim();
  }

  // 4. Hard character cap — emergency fallback
  if (text.length > MAX_WHATSAPP_CHARS) {
    const sub = text.slice(0, MAX_WHATSAPP_CHARS);
    // Try to break at the last sentence boundary within the slice
    const lastBreak = Math.max(
      sub.lastIndexOf('. '),
      sub.lastIndexOf('! '),
      sub.lastIndexOf('? '),
      sub.lastIndexOf('\n'),
    );
    text =
      lastBreak > 150 ? text.slice(0, lastBreak + 1).trim() : sub.trim() + '…';
  }

  return text;
}
import Dataset from '../models/Dataset';

import { OpenAIService } from './openai';
import { GroqService } from './groq';
import { OpenRouterService } from './openrouter';
import { CustomAIService } from './custom';
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

// Backstop timeout for a single provider call. Each provider service already
// guards its own network call, but this wrapper ensures a hung provider still
// triggers failover to the next provider in the chain.
const AI_REQUEST_TIMEOUT_MS =
  Number(process.env.AI_REQUEST_TIMEOUT_MS) || 45000;

// How long to skip a provider that returned 429 after retries, so a burst of
// inbound messages doesn't keep hammering an already rate-limited key (which
// only deepens the throttle). Other providers are tried first during cooldown.
const RATE_LIMIT_COOLDOWN_MS =
  Number(process.env.AI_RATE_LIMIT_COOLDOWN_MS) || 60000;
const MAX_429_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when an error is a provider rate-limit / quota (HTTP 429). */
export function isRateLimitError(err: any): boolean {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (status === 429) return true;
  const msg = String(err?.message ?? err ?? '');
  return /\b429\b|too many requests|rate.?limit|resource.?exhausted|quota/i.test(
    msg,
  );
}

/**
 * Extract the server-suggested retry delay from a Gemini 429 body
 * (`"retryDelay":"12s"`), capped so we never block a customer reply too long.
 * Falls back to the caller's exponential value when absent.
 */
export function parseRetryDelayMs(err: any, fallbackMs: number): number {
  const msg = String(err?.message ?? '');
  const m = msg.match(/retryDelay"?\s*[:=]\s*"?(\d+)(?:\.\d+)?\s*s/i);
  if (m) return Math.min(Number(m[1]) * 1000, 8000);
  return Math.min(fallbackMs, 8000);
}

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

  // Provider name → epoch ms until which it is considered rate-limited and
  // should be de-prioritised (still used as last resort if nothing else works).
  private rateLimitedUntil: Map<string, number> = new Map();

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
    // Don't let this timer keep the process alive (e.g. short-lived scripts
    // and the test runner) — the cleanup is best-effort housekeeping.
    this.cleanupInterval.unref?.();
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
        // conf.apiKey is undefined when CryptoService.decrypt failed
        // (ENCRYPTION_KEY mismatch). Skip the provider with a clear log
        // instead of attempting to use a garbage key — that produced the
        // 401/400 errors customers were seeing.
        if (!conf.apiKey) {
          console.warn(
            `⚠️ Skipping provider ${conf.providerType} (${conf.aiModel}): ` +
              `API key could not be decrypted. Re-enter the key in ` +
              `Admin Panel > Configuration > AI Providers.`,
          );
          continue;
        }
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
          } else if (
            conf.providerType === 'custom' ||
            conf.providerType === 'local'
          ) {
            // Any OpenAI-compatible endpoint (self-hosted Ollama/vLLM/LM Studio
            // or a hosted gateway). The operator supplies the base URL so we
            // are never locked to the few built-in providers.
            const baseUrl = (conf as any).baseUrl as string | undefined;
            if (!baseUrl) {
              console.warn(
                `⚠️ Skipping ${conf.providerType} provider (${conf.aiModel}): ` +
                  `no Base URL configured. Set it in Admin Panel > Configuration.`,
              );
            } else {
              this.services.push(
                new CustomAIService({
                  apiKey: conf.apiKey,
                  baseUrl,
                  model: conf.aiModel,
                  providerType: conf.providerType,
                }),
              );
            }
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
        CustomAIService: 5,
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

  /**
   * Order providers so any currently in 429 cooldown are tried LAST (but still
   * tried — better a possibly-throttled reply than the canned template).
   */
  private orderByCooldown(services: AIService[]): AIService[] {
    const now = Date.now();
    const fresh: AIService[] = [];
    const cooled: AIService[] = [];
    for (const s of services) {
      const until = this.rateLimitedUntil.get(s.constructor.name) ?? 0;
      (until > now ? cooled : fresh).push(s);
    }
    return [...fresh, ...cooled];
  }

  /**
   * Call one provider, retrying on 429 with exponential backoff (respecting the
   * server's retryDelay when present). On persistent 429 the provider is put
   * into a short cooldown and the error is rethrown so the caller fails over.
   */
  private async callProviderWithRetry(
    service: AIService,
    messages: AIChatMessage[],
  ): Promise<string> {
    let attempt = 0;
    for (;;) {
      try {
        return await withTimeout(
          service.generateResponse(messages),
          AI_REQUEST_TIMEOUT_MS,
          service.constructor.name,
        );
      } catch (err) {
        if (isRateLimitError(err) && attempt < MAX_429_RETRIES) {
          const wait = parseRetryDelayMs(err, 1000 * Math.pow(2, attempt));
          console.warn(
            `   ⏳ ${service.name} rate-limited (429) — backing off ${wait}ms ` +
              `(retry ${attempt + 1}/${MAX_429_RETRIES})`,
          );
          await sleep(wait);
          attempt++;
          continue;
        }
        if (isRateLimitError(err)) {
          this.rateLimitedUntil.set(
            service.constructor.name,
            Date.now() + RATE_LIMIT_COOLDOWN_MS,
          );
          console.warn(
            `   🚦 ${service.name} still rate-limited after ${MAX_429_RETRIES} retries — ` +
              `cooling down ${RATE_LIMIT_COOLDOWN_MS / 1000}s and failing over.`,
          );
        }
        throw err;
      }
    }
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

    // Try services in priority order, de-prioritising any in 429 cooldown.
    const ordered = this.orderByCooldown(this.services);
    for (let i = 0; i < ordered.length; i++) {
      const service = ordered[i];

      try {
        if (i > 0)
          console.log(
            `   ⚠️ Retrying with fallback: ${service.constructor.name}...`,
          );

        const start = Date.now();
        const rawResponse = await this.callProviderWithRetry(service, history);
        const duration = Date.now() - start;

        // Apply WhatsApp style enforcement: fix markdown, cap length,
        // preserve CTA. This is the hard guarantee — the AI prompt is the
        // soft request; this post-processor is the non-negotiable gate.
        const response = enforceWhatsAppStyle(rawResponse);

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
      : // No explicit provider: prefer providers not in 429 cooldown.
        this.orderByCooldown(this.services);

    let lastError: unknown = null;
    for (const service of ordered) {
      try {
        const start = Date.now();
        // Same 429 retry/backoff + cooldown as the conversational path so a
        // rate-limited agent call fails over instead of bubbling an error
        // that collapses the whole turn into the canned template.
        const text = await this.callProviderWithRetry(service, messages);
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

export const aiLoadBalancer = new AILoadBalancer();
