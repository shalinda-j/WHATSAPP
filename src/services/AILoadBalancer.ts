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

// Model slugs that are NOT chat/completion models. Registering one of these as
// a chat provider makes every /chat/completions call fail (usually 400), which
// takes down the whole fallback chain. Matched case-insensitively as a token
// inside the slug so `google/gemini-...-tts-preview`, `openai/whisper-1`,
// `text-embedding-3`, `dall-e-3`, etc. are all caught. Chat models with these
// words are not expected; voice/embeddings use dedicated services.
const NON_CHAT_MODEL_RE =
  /(^|[/\-_.:])(tts|whisper|speech|transcrib|audio|lyria|dall-?e|embed(ding)?|moderation|rerank|image|imagen)([/\-_.:]|$)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Maps a DB providerType (Config.providerType) to the lowercase substring that
 * matches the corresponding AIService class name (constructor.name.toLowerCase())
 * used by the provider-override reorder logic in sendMessage/sendMessageRaw.
 *
 * NOTE: google -> "gemini" is essential — the DB stores providerType "google"
 * but the service class is GeminiService, so "google" would never match.
 */
export const PROVIDER_TYPE_TO_OVERRIDE: Record<string, string> = {
  google: 'gemini',
  openai: 'openai',
  groq: 'groq',
  openrouter: 'openrouter',
  custom: 'custom',
  local: 'custom',
};

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
        // Skip models that aren't chat/completion models (text-to-speech,
        // transcription, image, embedding, moderation, rerank). Operators who
        // add e.g. `google/gemini-...-tts-preview` for VOICE would otherwise
        // have it registered as a CHAT provider, where every /chat/completions
        // call returns 400 and poisons the whole fallback chain. Voice reads
        // the OpenRouter key separately (openrouterVoice.ts) so deactivating it
        // here does not disable TTS.
        if (conf.aiModel && NON_CHAT_MODEL_RE.test(conf.aiModel)) {
          console.warn(
            `⚠️ Skipping provider ${conf.providerType} (${conf.aiModel}): ` +
              `this is an audio/TTS/embedding model, not a chat model. Pick a ` +
              `chat-capable model in Admin Panel > Configuration > AI Providers.`,
          );
          continue;
        }
        if (conf.apiKey) {
          // Construct the provider for this Config row, then stamp the Config
          // _id on it so usage tracking can attribute spend to the EXACT
          // provider row (matters for custom/session providers that share a
          // providerType/model and would otherwise be mis-attributed).
          const confId = String((conf as any)._id);
          let svc: AIService | null = null;
          if (conf.providerType === 'google') {
            svc = new GeminiService({
              apiKey: conf.apiKey,
              model: conf.aiModel,
              providerType: 'google',
            });
          } else if (conf.providerType === 'openai') {
            svc = new OpenAIService({
              apiKey: conf.apiKey,
              model: conf.aiModel,
              providerType: 'openai',
            });
          } else if (conf.providerType === 'groq') {
            svc = new GroqService({
              apiKey: conf.apiKey,
              model: conf.aiModel,
              providerType: 'groq',
            });
          } else if (conf.providerType === 'openrouter') {
            svc = new OpenRouterService({
              apiKey: conf.apiKey,
              model: conf.aiModel,
              providerType: 'openrouter',
            });
          } else if (conf.providerType === 'openai-session') {
            // Unofficial ChatGPT session-based provider (fallback only)
            svc = new ChatGPTSessionService({
              sessionToken: conf.apiKey,
              model: conf.aiModel,
              configId: confId,
              providerType: 'openai-session',
            });
          } else if (conf.providerType === 'claude-session') {
            // Unofficial Claude session-based provider (fallback only)
            svc = new ClaudeSessionService({
              sessionKey: conf.apiKey,
              organizationId: conf.value || undefined,
              model: conf.aiModel,
              configId: confId,
              providerType: 'claude-session',
            });
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
              svc = new CustomAIService({
                apiKey: conf.apiKey,
                baseUrl,
                model: conf.aiModel,
                providerType: conf.providerType,
                configId: confId,
              });
            }
          }
          // Add other providers here (e.g. Anthropic)

          if (svc) {
            // Stamp the Config _id on EVERY constructed service so trackUsage()
            // can $inc usageUsed on the precise provider row.
            (svc as any).configId = confId;
            this.services.push(svc);
          }
        }
      }
    } catch (dbErr) {
      // Isolated so a transient Mongo failure doesn't also wipe out the env-key
      // failover providers below. Previously a single throw here skipped env
      // supplementation entirely, collapsing every reply into the canned
      // "No AI services configured" template even with valid env keys present.
      console.error(
        'Failed to load AI providers from DB (continuing with env failover):',
        dbErr,
      );
    }

    // Env-key supplementation + priority sort. This ALWAYS runs — even when the
    // DB read above failed — so provider keys in the environment act as true
    // failover instead of being skipped on a Mongo blip.
    try {
      // Supplement DB providers with any provider keys present in the
      // environment that aren't already configured. Without this, a deployment
      // whose Gemini quota is exhausted (free tier = 250/day) had NOTHING to
      // fail over to — every reply collapsed into the canned template — even
      // when a perfectly good GROQ_API_KEY sat in the env. Groq is priority 1,
      // so when present it becomes primary and the bot mostly bypasses the
      // Gemini quota entirely.
      const isRealKey = (k?: string | null) =>
        !!k && k.trim().length > 0 && !/^your_.*_here$/i.test(k.trim());
      const loadedTypes = new Set(this.services.map((s) => s.constructor.name));

      const envProviders: Array<{
        type: string;
        key?: string;
        make: () => AIService;
      }> = [
        {
          type: 'GroqService',
          key: process.env.GROQ_API_KEY,
          make: () =>
            new GroqService({
              apiKey: process.env.GROQ_API_KEY as string,
              // The library default (mixtral-8x7b-32768) is decommissioned;
              // pin a current Groq model, overridable via GROQ_MODEL.
              model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            }),
        },
        {
          type: 'GeminiService',
          key: process.env.GEMINI_API_KEY,
          make: () =>
            new GeminiService({ apiKey: process.env.GEMINI_API_KEY as string }),
        },
        {
          type: 'OpenRouterService',
          key: process.env.OPENROUTER_API_KEY,
          make: () =>
            new OpenRouterService({
              apiKey: process.env.OPENROUTER_API_KEY as string,
              model: process.env.OPENROUTER_MODEL || undefined,
            }),
        },
        {
          type: 'OpenAIService',
          key: process.env.OPENAI_API_KEY,
          make: () =>
            new OpenAIService({
              apiKey: process.env.OPENAI_API_KEY as string,
              model: process.env.OPENAI_MODEL || undefined,
            }),
        },
      ];

      for (const ep of envProviders) {
        if (loadedTypes.has(ep.type)) continue; // already loaded from DB
        if (!isRealKey(ep.key)) continue;
        const svc = ep.make();
        // Apply the same non-chat-model guard as DB providers: if the operator
        // pointed a *_MODEL env var at a TTS/embedding/transcription model,
        // don't register it as a chat provider (it would 400 on every
        // completion and poison the whole fallback chain).
        const envModel = svc.name?.match(/\(([^)]+)\)/)?.[1] ?? '';
        if (envModel && NON_CHAT_MODEL_RE.test(envModel)) {
          console.warn(
            `⚠️ Skipping ${ep.type} from env: model "${envModel}" is not a ` +
              `chat model. Set a chat-capable *_MODEL env var.`,
          );
          continue;
        }
        this.services.push(svc);
        loadedTypes.add(ep.type);
        console.log(`➕ Added ${ep.type} from environment key (failover).`);
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
      console.error('Failed during env provider supplementation:', err);
    }
  }

  /**
   * Force reload of services (call when config is updated)
   */
  async forceReloadServices(): Promise<void> {
    this.lastServiceLoad = 0;
    await this.loadServices();
  }

  /**
   * Attribute token spend to the provider's Config row.
   *
   * Prefers the exact Config _id stamped on the service in _doLoadServices
   * (set for EVERY provider, including custom/session ones that share a
   * providerType+model and were previously mis-attributed or no-op'd). Falls
   * back to the legacy providerType+model heuristic only when no configId is
   * available (e.g. env-supplied failover providers that have no DB row).
   *
   * Accepts either the AIService object (preferred) or a bare provider name
   * string (legacy callers).
   */
  private async trackUsage(
    service: AIService | string,
    inputTokens: number,
    outputTokens: number,
  ) {
    try {
      const configId =
        typeof service === 'string'
          ? undefined
          : ((service as any).configId as string | undefined);

      // Preferred path: exact provider row by _id.
      if (configId) {
        await Config.updateOne(
          { _id: configId },
          { $inc: { usageUsed: inputTokens + outputTokens } },
        );
        return;
      }

      // Fallback heuristic: derive provider type + model from the name.
      const providerName = typeof service === 'string' ? service : service.name;

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

  /**
   * Build the live system-prompt content from current config: the operator's
   * AI_PERSONALITY (Admin Panel → Datasets → AI_PERSONALITY) plus the dynamic
   * knowledge base. Read fresh so personality edits apply immediately.
   */
  private async buildSystemContent(tenantId?: string): Promise<string> {
    const knowledgeBase = await knowledgeTrainingService.getKnowledgeBaseForAI(
      undefined,
      tenantId,
    );
    const aiPersonality = await configurationManager.getAIPersonality();
    return `${aiPersonality}\n\n${knowledgeBase}`;
  }

  private async getInitialHistory(
    tenantId?: string,
    systemContentOverride?: string | null,
  ): Promise<AIChatMessage[]> {
    const conversationExamples = await getConversationExamples();

    const history: AIChatMessage[] = [
      {
        role: 'system',
        // With an override supplied there is no point assembling the global
        // system content just to replace it a few lines later — that read is
        // the whole 100-entry knowledge base.
        content:
          systemContentOverride?.trim() ||
          (await this.buildSystemContent(tenantId)),
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
   * Order services for a request, honouring an optional provider pin.
   *
   * The pin is normalised through PROVIDER_TYPE_TO_OVERRIDE first, so a DB
   * providerType like "google" correctly maps to the GeminiService class name
   * — previously agents forwarded the raw providerType and it never matched, so
   * the pin was silently ignored. With no pin we fall back to cooldown order.
   */
  private orderByProviderOverride(
    providerOverride?: string | null,
  ): AIService[] {
    if (!providerOverride) return this.orderByCooldown(this.services);
    const key = providerOverride.toLowerCase();
    const needle = (PROVIDER_TYPE_TO_OVERRIDE[key] ?? key).toLowerCase();
    const match = this.services.filter((s) =>
      s.constructor.name.toLowerCase().includes(needle),
    );
    const rest = this.services.filter(
      (s) => !s.constructor.name.toLowerCase().includes(needle),
    );
    // If nothing matched the pin, keep the normal order rather than an empty
    // "matched" set followed by everything (functionally identical, but this is
    // clearer and lets the caller log a miss if desired).
    return match.length > 0 ? [...match, ...rest] : rest;
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

  /**
   * @param systemContentOverride Replaces the global system prompt (personality
   *   + full knowledge base) for this call. The kiosk uses it to supply its own
   *   scoped, relevance-ranked context — see KioskDatasetService. Without it
   *   the caller would get the kiosk KB *in addition to* the global one, which
   *   is worse than either alone. Falsy/blank behaves exactly as before.
   */
  async sendMessage(
    userId: string,
    message: string,
    tenantId?: string,
    providerOverride?: string | null,
    systemContentOverride?: string | null,
  ): Promise<string> {
    // Load services with caching (not on every message)
    await this.loadServices();

    if (this.services.length === 0) {
      return '⚠️ No AI services are configured. Please check the Admin Panel.';
    }

    // Get history from persistent storage
    let history: AIChatMessage[] = [];

    // Cache key MUST include the tenant: the in-memory cache sits in front of
    // the now-tenant-scoped DB read, so keying by userId alone would re-serve
    // one tenant's cached turns to another tenant sharing the same external
    // userId (e.g. the per-tenant kiosk path) — re-introducing the very
    // cross-tenant context leak the DB scoping fixed.
    const histKey = `${tenantId || ''}:${userId}`;

    // Try to get cached history first (for same-request optimization).
    // Clone it — do NOT alias the cached array. Two concurrent messages from
    // the same user (distinct texts sent seconds apart, within one provider
    // call's await window) would otherwise push/re-trim the ONE shared array
    // reference, scrambling turn order and double-persisting turns. Each
    // request works on its own copy; the cache is re-committed on success.
    const cachedHistory = this.historyCache.get(histKey);
    if (cachedHistory) {
      history = [...cachedHistory];
    } else {
      // Get from persistent storage
      const persistedMessages = await conversationHistoryService.getHistory(
        userId,
        tenantId,
      );
      if (persistedMessages.length > 0) {
        history = persistedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
      } else {
        // Initialize with system prompt and examples for THIS request only.
        history = await this.getInitialHistory(tenantId, systemContentOverride);
        // Persist ONLY the system anchor — never the synthetic few-shot
        // example turns. Those must stay in-memory for the AI's few-shot
        // priming, but persisting them pollutes the shared ConversationHistory
        // collection that the agent path reads (it expects genuine user/
        // assistant turns). The system prompt is also rebuilt fresh on every
        // request below, so the persisted copy is just an anchor.
        const seed = history.filter((h) => h.role === 'system');
        await conversationHistoryService.setInitialHistory(
          userId,
          seed.map((h) => ({
            role: h.role,
            content: h.content,
            timestamp: new Date(),
          })),
          tenantId,
        );
      }
      // Cache a CLONE of the freshly-built base (system + few-shot). We then
      // push the user/assistant turns onto our local `history`; the cache is
      // only re-committed on a successful reply (below). So if every provider
      // fails and we throw, the cache keeps the clean base instead of a
      // dangling user turn with no assistant reply (which would poison context
      // and stack up on each outage).
      this.historyCache.set(histKey, [...history]);
    }

    // Always refresh the system prompt from current config so edits to
    // AI_PERSONALITY take effect on the very next message — even for
    // conversations that started before the edit. Previously the system prompt
    // was captured only on a user's FIRST message and persisted forever, so
    // personality changes were silently ignored for every existing chat.
    // A caller-supplied prompt wins, but is still refreshed into slot 0 on every
    // turn — the kiosk's ranked knowledge changes with each utterance, and the
    // persisted history holds whatever was relevant to the FIRST one.
    const freshSystem =
      systemContentOverride?.trim() ||
      (await this.buildSystemContent(tenantId));
    if (history.length > 0 && history[0].role === 'system') {
      history[0] = { role: 'system', content: freshSystem };
    } else {
      history.unshift({ role: 'system', content: freshSystem });
    }

    // Add user message to history
    history.push({ role: 'user', content: message });

    this.totalRequests++;

    // Try services in priority order, de-prioritising any in 429 cooldown.
    // When a providerOverride is supplied, try matching providers FIRST (mirror
    // the EXACT reorder logic in sendMessageRaw), then fall back to the normal
    // orderByCooldown order. When null/undefined, behave exactly as before.
    const ordered = this.orderByProviderOverride(providerOverride);
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

        // Guard against an empty/whitespace reply. Providers can return ''
        // without throwing, which would otherwise short-circuit the failover
        // loop AND poison history/cache with a blank assistant turn. Skip to
        // the next provider; if all yield empty the loop throws below and
        // index.ts falls back to its own template chain.
        if (!response || !response.trim()) {
          console.warn(
            `   ⚠️ ${service.name} returned an empty reply — failing over`,
          );
          continue;
        }

        // Add assistant response to history
        history.push({ role: 'assistant', content: response });

        // Persist the new messages to database (fire and forget)
        conversationHistoryService
          .addMessage(userId, 'user', message, tenantId)
          .catch((err) => {
            console.error('Failed to persist user message:', err);
          });
        conversationHistoryService
          .addMessage(userId, 'assistant', response, tenantId)
          .catch((err) => {
            console.error('Failed to persist assistant message:', err);
          });

        // AUTO-LEARN from successful conversation (fire and forget)
        // Only learn if response is substantial (> 50 chars)
        if (response.length > 50 && message.length > 10) {
          knowledgeTrainingService
            .learnFromConversation(message, response, 0.7, tenantId)
            .catch((err) => {
              // Silent fail - learning is optional
            });
        }

        // Cap the warm in-memory history to mirror the DB's 50-message cap
        // (ConversationHistoryService trims to -50). A warm cache entry is
        // never reloaded from the trimmed DB, so without this it grows
        // unbounded per user — inflating token cost and eventually overflowing
        // the provider context window. Preserve the leading system turn.
        // (Cache the trimmed copy; usage tracking below still uses the full
        // `history` that was actually sent to the provider.)
        const MAX_TURNS = 48;
        const trimmedHistory =
          history.length > MAX_TURNS + 1
            ? [
                ...(history[0]?.role === 'system' ? [history[0]] : []),
                ...history.slice(-MAX_TURNS),
              ]
            : history;

        // Update cache (tenant-scoped key)
        this.historyCache.set(histKey, trimmedHistory);

        // TRACK USAGE
        // Estimate: 4 chars = 1 token. Exclude the assistant turn we just
        // pushed (line above) — the INPUT sent to the provider was everything
        // BEFORE the reply. Counting the reply here would double-count it as
        // both input and output and inflate usageUsed on the Config row.
        const inputLen = history
          .slice(0, -1)
          .reduce((acc, msg) => acc + msg.content.length, 0);
        const outputLen = response.length;
        const inputTokens = Math.ceil(inputLen / 4);
        const outputTokens = Math.ceil(outputLen / 4);

        // Fire and forget usage tracking (pass the service so trackUsage can
        // attribute spend to the exact Config row via its configId).
        this.trackUsage(service, inputTokens, outputTokens);

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

    let ordered = this.orderByProviderOverride(options.providerOverride);

    // Honour an optional per-call model pin by preferring loaded providers whose
    // model matches (service.name embeds the model, e.g. "Gemini (…)"). Exact
    // per-call model switching would need the provider to be loaded with that
    // model; when none matches this is a no-op rather than being silently
    // dropped as before.
    if (options.modelOverride) {
      const mo = options.modelOverride.toLowerCase();
      const withModel = ordered.filter((s) =>
        (s.name ?? '').toLowerCase().includes(mo),
      );
      if (withModel.length > 0) {
        ordered = [
          ...withModel,
          ...ordered.filter((s) => !(s.name ?? '').toLowerCase().includes(mo)),
        ];
      }
    }

    let lastError: unknown = null;
    for (const service of ordered) {
      try {
        const start = Date.now();
        // Same 429 retry/backoff + cooldown as the conversational path so a
        // rate-limited agent call fails over instead of bubbling an error
        // that collapses the whole turn into the canned template.
        const text = await this.callProviderWithRetry(service, messages);
        // Guard against an empty/whitespace reply. A provider can return ''
        // without throwing; the conversational path already fails over on this,
        // but the agent path used to return the blank as a "successful" result.
        // Treat it as a failure and try the next provider.
        if (!text || !text.trim()) {
          lastError = new Error(`${service.name} returned an empty reply`);
          console.warn(
            `sendMessageRaw: ${service.name} returned empty — failing over`,
          );
          continue;
        }
        const latencyMs = Date.now() - start;
        const inputLen = messages.reduce((a, m) => a + m.content.length, 0);
        const inputTokens = Math.ceil(inputLen / 4);
        const outputTokens = Math.ceil(text.length / 4);
        this.trackUsage(service, inputTokens, outputTokens);
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

  /**
   * Force-load providers and report what is actually wired up RIGHT NOW —
   * provider type, the (already coerced) model, and any active 429 cooldown.
   * Surfaced on /health so the live deployment can be proven to use a
   * SUPPORTED model (no gemini-3.x) without sending a real WhatsApp message.
   */
  async getLoadedProviderInfo(): Promise<
    Array<{ provider: string; model: string; rateLimited: boolean }>
  > {
    await this.loadServices();
    const now = Date.now();
    return this.services.map((s) => {
      const match = s.name?.match(/\(([^)]+)\)/);
      return {
        provider: s.constructor.name,
        model: match ? match[1] : '',
        rateLimited: (this.rateLimitedUntil.get(s.constructor.name) ?? 0) > now,
      };
    });
  }

  async clearConversation(userId: string, tenantId?: unknown) {
    await conversationHistoryService.clearHistory(userId, tenantId);
    this.historyCache.delete(`${tenantId || ''}:${userId}`);
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
