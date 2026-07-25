import { validateEnvironment } from './config/env';
validateEnvironment();

import {
  onMessage,
  sendMessage,
  sendTyping,
  getMessageText,
  isFromMe,
  getSenderJid,
  downloadWhatsAppAudio,
  sendVoiceMessage,
  connectToWhatsApp,
  disconnectWhatsApp,
} from './services/whatsapp';
import { connectToMongoDB } from './services/MongoAuthService';
import {
  seedAIProviders,
  migrateDeprecatedAIModels,
} from './services/AIProviderSeeder';
import { seedDatasets } from './services/DatasetSeeder';
import { seedDefaultFormTemplate } from './services/FormTemplateSeeder';
import { seedAdminFromEnv } from './services/AdminSeeder';
import {
  transcribeAudio,
  generateSpeech,
  transcribeAudioWithLanguage,
  detectLanguage,
} from './services/voice';
import { aiLoadBalancer } from './services/AILoadBalancer';
import {
  detectIncomingMedia,
  analyzeIncomingMedia,
  buildMediaPromptText,
} from './services/mediaUnderstanding';
import { chatPersonality } from './services/ChatPersonality';
import { leadScoringService } from './services/LeadScoringService';
import { messageQuality } from './services/MessageQualityService';
import { autoresearchNLP, classifyMessage } from './services/autoresearchNLP';
import { analyzeLeadIntent } from './services/gemini';
import { WebhookService } from './services/WebhookService';
import { configService } from './services/ConfigService';
import { configurationManager } from './services/ConfigurationManagerService';
import { DEFAULT_COUNTRY_CODE, COUNTRY_INTERESTS } from './config/brand';
import {
  handleBookingMessage,
  startBookingFlow,
  startBookingDatePicker,
  handleSpecificDateRequest,
} from './services/BookingService';
import { sanitizeBookingReply } from './utils/sanitizeBookingReply';
import {
  handleLeadMessage,
  startLeadRegistration,
  isUserInLeadFlow,
} from './services/LeadService';
import { FormService } from './services/FormService';
import app from './server/app';
import mongoose from 'mongoose';
import { commandDispatcher } from './app/utils/CommandDispatcher';
import './app/commands';
import ChatMessage from './models/ChatMessage';
import VoiceConfig from './models/VoiceConfig';
import { initSocket, getIO } from './server/socket';
import { autoRegistrationService } from './services/AutoRegistrationService';
import { enrichContactFromMessage } from './services/ConversationEnrichmentService';
import { usageResetService } from './services/UsageResetService';
import { agentOrchestrator } from './services/AgentOrchestrator';
import { agentReflectionService } from './services/AgentReflectionService';
import { registerCoreAgents } from './agents/bootstrap';
import { isAiPaused, loadAiPaused } from './services/aiPause';
import { registerCoreChannels, channelRouter } from './channels';
import { classifyIntent } from './services/IntentClassifierService';
import { HumanizerService } from './services/HumanizerService';
import { isStopKeyword, markContactOptedOut } from './services/optOut';
import { scoreSentiment } from './services/sentiment';
import { autoTagLeadFromMessage } from './services/leadAutoTag';
import {
  extractPhoneJidFromMessage,
  extractRealPhone,
  extractPhoneFromContactCard,
} from './utils/jid';
import {
  extractPhoneFromText,
  rememberLidPhoneMapping,
  backfillRealPhoneOnExistingMessages,
} from './services/LidPhoneMappingService';
import { conversationHistoryService } from './services/ConversationHistoryService';

const PORT = parseInt(process.env.PORT || '8080', 10);
let server: any;

// FIX M14: Cache VoiceConfig in memory (5-minute TTL) so we don't hit
// MongoDB on every single incoming voice message.
let voiceConfigCache: { mode: string } | null = null;
let voiceConfigCacheTime = 0;
const VOICE_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getVoiceConfigCached(): Promise<{ mode: string }> {
  const now = Date.now();
  if (
    voiceConfigCache &&
    now - voiceConfigCacheTime < VOICE_CONFIG_CACHE_TTL_MS
  ) {
    return voiceConfigCache;
  }
  // Read the ACTIVE config's mode, matching the active-only readers in
  // voice.ts (getActiveVoiceConfig et al.). Previously this took the newest row
  // regardless of isActive, so a newer disabled row could override the mode of
  // the currently-active voice config.
  const fresh = await VoiceConfig.findOne({ isActive: true })
    .sort({ updatedAt: -1 })
    .lean();
  voiceConfigCache = { mode: fresh?.mode || 'voice-and-text' };
  voiceConfigCacheTime = now;
  return voiceConfigCache;
}

/**
 * Distinguish real English from Singlish (Sinhala written in Latin letters,
 * e.g. "ayubowan kohomada", "mata Japan job ekak ona"). The old "is the
 * text only Latin letters?" check classified Singlish as English and the
 * bot replied in English to Sinhala-speaking customers. We now require at
 * least two common English function words; Singlish phrases rarely contain
 * any, so they fall through to the Sinhala branch.
 */
const ENGLISH_FUNCTION_WORDS =
  /\b(the|is|are|am|i|you|he|she|we|they|my|your|it|and|or|but|what|how|why|when|where|can|could|would|should|please|hello|hi|thank|thanks|yes|no|okay|ok|need|want|have|has|had|do|does|did|will|with|from|about|for|on|in|at|by|of|me|us|them|this|that|these|those|been|was|were|going|going to|just|now|here|there)\b/gi;
function isEnglishText(text: string): boolean {
  if (!text) return false;
  return (text.match(ENGLISH_FUNCTION_WORDS) || []).length >= 2;
}

type LeadFlowFact = {
  phone: string | null;
  country: string | null;
  name: string | null;
};

function extractPhoneFromLeadText(text: string): string | null {
  const candidates = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];

  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) {
      return `${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
    }
    if (digits.length >= 8 && digits.length <= 15) {
      return digits;
    }
  }

  return null;
}

function extractCountryInterest(text: string): string | null {
  const match = COUNTRY_INTERESTS.find((country) => country.pattern.test(text));
  return match?.label ?? null;
}

function extractNameHint(text: string): string | null {
  const patterns = [
    /\bmy\s+name\s+(?:is\s+)?([a-z][a-z\s.'-]{1,40})/i,
    /\bname\s+(?:is\s+)?([a-z][a-z\s.'-]{1,40})/i,
    /\b(?:mage|mge|maage)\s+nama\s+([a-z][a-z\s.'-]{1,40})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = match?.[1]?.trim().replace(/\s+/g, ' ');
    if (name) return name;
  }

  return null;
}

function getLeadFlowFacts(text: string): LeadFlowFact {
  return {
    phone: extractPhoneFromLeadText(text),
    country: extractCountryInterest(text),
    name: extractNameHint(text),
  };
}

function isGreetingMessage(text: string): boolean {
  return /^(hi|hello|hey|good\s+(morning|afternoon|evening)|ayubowan|vanakkam)\b/i.test(
    text.trim(),
  );
}

/**
 * Per-user accumulated lead facts. In-memory only — lost on restart, which
 * is fine because this state is solely for the AI-down fallback path.
 * Persistent lead capture happens via LeadService once the customer hits
 * !register or completes a form. The map prevents the fallback from asking
 * "which country?" again after the customer already said "Japan".
 */
const leadFlowState = new Map<string, LeadFlowFact>();
// Hard cap to stop unbounded growth: one entry accumulates per distinct sender
// that hits the AI-down fallback path and nothing else evicts them. The sibling
// dedup/last-message maps have periodic cleanup; this map had none, so over a
// long-running process (especially during an AI outage when this path is hot)
// it leaked one entry per JID forever. Insertion-order eviction, with a
// delete+set on each write so an active sender's entry refreshes to newest.
const MAX_LEAD_FLOW_SIZE = 10_000;

function mergeLeadFacts(jid: string, latest: LeadFlowFact): LeadFlowFact {
  const existing = leadFlowState.get(jid) ?? {
    phone: null,
    country: null,
    name: null,
  };
  const merged: LeadFlowFact = {
    phone: latest.phone ?? existing.phone,
    country: latest.country ?? existing.country,
    name: latest.name ?? existing.name,
  };
  // Refresh recency: deleting before set moves this jid to the newest slot in
  // Map insertion order, so eviction targets genuinely-stale senders.
  leadFlowState.delete(jid);
  if (leadFlowState.size >= MAX_LEAD_FLOW_SIZE) {
    const oldest = leadFlowState.keys().next().value;
    if (oldest !== undefined) leadFlowState.delete(oldest);
  }
  leadFlowState.set(jid, merged);
  return merged;
}

/**
 * Substitute {name}, {country}, {phone} placeholders in a Dataset template.
 * Empty/missing facts become empty strings — operators can wrap optional
 * variables in punctuation that simply collapses when blank.
 */
function fillLeadTemplate(template: string, facts: LeadFlowFact): string {
  return template
    .replace(/\{name\}/g, facts.name ?? '')
    .replace(/\{country\}/g, facts.country ?? '')
    .replace(/\{phone\}/g, facts.phone ?? '');
}

/**
 * Lead-intake fallback used only when the AI providers are down or not
 * configured. Reads ALL templates from the LEAD_FALLBACK_TEMPLATES Dataset
 * (configured via Admin Panel) — no hardcoded customer-facing text in source.
 *
 * Per-user state (leadFlowState) remembers phone/country/name across turns
 * so the bot never asks the customer to repeat themselves. The template
 * for the matching state slot is fetched from Dataset and placeholders are
 * substituted.
 *
 * Returns the empty string when the matching template slot is not yet
 * configured — the caller MUST treat empty as "do not reply" rather than
 * inventing a default message.
 */
async function buildLeadFlowFallback(
  text: string,
  jid: string,
): Promise<string> {
  const latest = getLeadFlowFacts(text);
  const facts = mergeLeadFacts(jid, latest);
  const templates = await configService.getLeadFallbackTemplates();

  let template = '';
  if (facts.phone && facts.country && facts.name) {
    template = templates.haveAll;
  } else if (facts.phone && facts.country) {
    template = templates.havePhoneCountry;
  } else if (facts.phone) {
    template = templates.havePhone;
  } else if (facts.country) {
    template = templates.haveCountry;
  } else if (facts.name) {
    template = templates.haveName;
  } else if (isGreetingMessage(text)) {
    template = templates.greeting;
  } else {
    template = templates.empty;
  }

  if (!template) {
    // LEAD_FALLBACK_TEMPLATES isn't configured. Rather than go silent on a
    // real customer (the worst outcome — they think we ignored them), send a
    // safe, language-matched holding reply that still moves toward a visit.
    // This is what keeps the bot responsive even when every AI provider is
    // rate-limited / down. Operators can override the wording via the dataset.
    console.warn(
      '⚠️ LEAD_FALLBACK_TEMPLATES slot not configured — using built-in safe reply. Configure via Admin Panel > Datasets > LEAD_FALLBACK_TEMPLATES.',
    );
    return DEFAULT_SAFE_REPLY;
  }
  return fillLeadTemplate(template, facts);
}

// Last-resort customer reply used when AI providers are unavailable AND no
// LEAD_FALLBACK_TEMPLATES are configured. Bilingual (Sinhala + English) so it
// reads naturally for the default market while staying clear to English users.
const DEFAULT_SAFE_REPLY =
  'ස්තූතියි ඔබ අප හා සම්බන්ධ වීම ගැන! 🙏 අපි ඔබට ඉක්මනින්ම පිළිතුරු දෙන්නම්. ' +
  'ඔබ සොයන රැකියාව / පුහුණුව මොකක්ද කියලා කියන්න — එවිට හරියටම උදව් කරන්න පුළුවන්.\n\n' +
  'Thanks for reaching out! We will get back to you shortly. ' +
  'Tell us what job or training you are looking for so we can help you best. 🌟';

async function startServer() {
  // 1. Connect to Database
  if (!process.env.MONGODB_URI) {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ MONGODB_URI is required in production. Exiting.');
      process.exit(1);
    }
    console.warn(
      '⚠️ No MONGODB_URI found. Some features (Admin Panel) may not work.',
    );
  }

  if (process.env.MONGODB_URI) {
    try {
      await connectToMongoDB(process.env.MONGODB_URI);
      // Create a super-admin from env creds on a fresh DB so operators can log
      // in without hitting the setup screen. No-op once any admin exists.
      await seedAdminFromEnv();
      // Seed AI providers from .env into the Config collection
      await seedAIProviders();
      // Self-heal any provider still pinned to a retired Gemini model (404s).
      // Must run before the first message is handled so the AI chain is live.
      await migrateDeprecatedAIModels();
      await seedDatasets();
      await seedDefaultFormTemplate();
      // One-shot stamp of realPhone on every legacy ChatMessage that the
      // LidPhoneMapping table can resolve. Idempotent — only touches
      // rows where realPhone is missing/empty. Runs after seedDatasets
      // so any same-boot migration is already done.
      await backfillRealPhoneOnExistingMessages();

      // Clean up ONLY expired sessions on startup. In-progress booking/lead/
      // form flows (expiresAt still in the future) MUST survive a restart —
      // wiping them defeats the whole point of SessionStateService persistence.
      // The TTL index on expiresAt (expireAfterSeconds: 0) handles ongoing
      // staleness automatically; this just clears anything already past TTL so
      // a stale row can't briefly resurface before Mongo's TTL sweep runs.
      const SessionState = (await import('./models/SessionState')).default;
      const result = await SessionState.deleteMany({
        expiresAt: { $lt: new Date() },
      });
      console.log(
        `🧹 Cleaned up ${result.deletedCount} expired sessions on startup`,
      );

      // Start monthly usage reset scheduler
      usageResetService.start();

      // Start agent self-improvement scheduler (approval expiry + nightly promotion)
      agentReflectionService.start();

      // Restore the AI pause kill-switch state (survives restarts mid-incident).
      await loadAiPaused();

      // Register specialist agents and seed their initial prompts
      await registerCoreAgents();

      // Register channel adapters. WhatsApp inbound stays on the legacy
      // onMessage chain (further down in this file) to avoid double-
      // processing; the channelRouter pipe only handles inbound from
      // adapters that aren't WhatsApp (Telegram today, Instagram /
      // Facebook / Email once their webhooks land).
      registerCoreChannels();
      channelRouter.onInbound(async (msg) => {
        if (msg.channel === 'whatsapp') return; // owned by legacy handler
        try {
          const channelHistory = await conversationHistoryService
            .getHistory(msg.externalUserId, msg.tenantId)
            .then((h) =>
              // Drop persisted system entries (personality/KB anchor written by
              // AILoadBalancer) — agents expect only genuine user/assistant turns.
              h
                .filter((m) => m.role !== 'system')
                .slice(-10)
                .map((m) => ({
                role: m.role as 'user' | 'assistant' | 'system',
                content: m.content,
              })),
            )
            .catch(
              () =>
                [] as {
                  role: 'user' | 'assistant' | 'system';
                  content: string;
                }[],
            );
          const outcome = await agentOrchestrator.handle({
            sessionId: msg.tenantId,
            userId: msg.externalUserId,
            channel: msg.channel,
            language: 'si',
            inputMessage: msg.text ?? '',
            conversationHistory: channelHistory,
            metadata: { externalThreadId: msg.externalThreadId ?? '' },
          });
          if (outcome.handled && outcome.outbound) {
            await channelRouter.send({
              channel: msg.channel,
              tenantId: msg.tenantId,
              // Meta (Instagram/Facebook) replies must go to the customer's
              // PSID/IGSID (externalUserId), NOT the page/thread id — otherwise
              // the bot replies to the business account itself. Telegram and
              // others keep using their thread/chat id.
              recipient:
                msg.channel === 'instagram' || msg.channel === 'facebook'
                  ? msg.externalUserId
                  : (msg.externalThreadId ?? msg.externalUserId),
              text: outcome.outbound,
            });
          }
        } catch (err) {
          console.error(
            `channelRouter inbound (${msg.channel}) processing failed:`,
            err,
          );
        }
      });

      // Ensure a default tenant exists AND backfill tenantId on every
      // pre-multi-tenant collection. Idempotent — on subsequent boots
      // the migration is a no-op because every row already has tenantId.
      const { ensureDefaultTenantAndMigrate } =
        await import('./services/TenantBootstrapService');
      const { tenant: defaultTenant } = await ensureDefaultTenantAndMigrate();
      defaultTenantId = String(defaultTenant._id);
      await channelRouter.startAll(String(defaultTenant._id));

      // Start channel adapters for EVERY tenant that has active/pending
      // channel connections — not just the default. Without this, non-default
      // tenants lose Telegram inbound (long-poll) after every restart and even
      // webhook-mode replies fail because send() never loaded their token. One
      // try/catch per tenant so one tenant's failure can't block the rest.
      try {
        const ChannelConnection = (await import('./models/ChannelConnection'))
          .default;
        const tenantIds: unknown[] = await ChannelConnection.distinct(
          'tenantId',
          { status: { $in: ['active', 'pending'] } },
        );
        for (const tid of tenantIds) {
          if (!tid || String(tid) === String(defaultTenant._id)) continue;
          try {
            await channelRouter.startAll(String(tid));
          } catch (e) {
            console.error(
              `channelRouter.startAll failed for tenant ${String(tid)}:`,
              e,
            );
          }
        }
      } catch (e) {
        console.error('Multi-tenant channel autostart failed:', e);
      }

      // Boot the periodic campaign sender for EVERY active tenant — not just
      // the default. Without this, non-default tenants' CampaignExecution rows
      // stay 'queued' forever because tickSender is never scheduled for them.
      // startCampaignSender is idempotent per tenantId (it no-ops when a timer
      // already exists), so starting the default here AND again in the loop
      // below cannot double-start. One try/catch per tenant so one tenant's
      // failure can't block the rest. Mirrors the channelRouter.startAll loop.
      const { startCampaignSender } =
        await import('./services/CampaignService');
      startCampaignSender(String(defaultTenant._id));
      try {
        const Tenant = (await import('./models/Tenant')).default;
        const activeTenants = await Tenant.find({ status: 'active' })
          .select('_id')
          .lean();
        for (const t of activeTenants) {
          const tid = String((t as any)._id);
          if (!tid || tid === String(defaultTenant._id)) continue;
          try {
            startCampaignSender(tid);
          } catch (e) {
            console.error(`startCampaignSender failed for tenant ${tid}:`, e);
          }
        }
      } catch (e) {
        console.error('Multi-tenant campaign sender autostart failed:', e);
      }

      // Boot the follow-up scheduler so FollowUpAgent fires on cron
      // against dormant leads (>= 5 days since last update).
      const { startFollowUpScheduler } =
        await import('./services/FollowUpScheduler');
      startFollowUpScheduler();
    } catch (dbErr) {
      console.error('❌ MongoDB Connection Failed:', dbErr);
      if (process.env.NODE_ENV === 'production') {
        console.error('Exiting — cannot run without database in production.');
        process.exit(1);
      }
      console.warn('Server starting in LIMITED MODE (dev only).');
    }
  }

  // 2. Start Admin API
  server = app.listen(PORT, () => {
    console.log(`🚀 Admin API Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  });

  // Initialize Socket.io
  initSocket(server);

  // 3. Connect to WhatsApp — but FIRST, optionally wait for the previous
  // pod to fully disconnect. During rolling deploys, DigitalOcean App
  // Platform starts the new pod while the old one still holds the
  // WhatsApp socket; if we connect immediately, WhatsApp sees two devices
  // with the same credentials and kicks BOTH with status 440 ("replaced").
  // Setting WHATSAPP_STARTUP_DELAY_MS to ~60000 in production lets the old
  // pod's graceful shutdown finish first. Default 0 = no delay (dev).
  const startupDelayMs = parseInt(
    process.env.WHATSAPP_STARTUP_DELAY_MS || '0',
    10,
  );
  if (Number.isFinite(startupDelayMs) && startupDelayMs > 0) {
    console.log(
      `⏳ Waiting ${startupDelayMs}ms before WhatsApp connect (avoids rolling-deploy 440 conflict)...`,
    );
    await new Promise((r) => setTimeout(r, startupDelayMs));
  }
  // FIX C1: Start HumanizerService cleanup interval — prevents message
  // queue from growing unbounded and eventually crashing the process.
  HumanizerService.initializeCleanup();
  console.log('🧹 HumanizerService cleanup scheduler started');

  await connectToWhatsApp();
}

/**
 * SUCCESSFUL SHUTDOWN HANDLER
 * Prevents "Conflict" errors by ensuring the old session is dead before the new one starts.
 */
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Closing connections gracefully...`);

  try {
    // 0. Stop background schedulers
    agentReflectionService.stop();
    try {
      const { stopCampaignSender } = await import('./services/CampaignService');
      stopCampaignSender();
    } catch (err) {
      console.error('   ⚠️ stopCampaignSender failed:', err);
    }
    try {
      const { stopFollowUpScheduler } =
        await import('./services/FollowUpScheduler');
      stopFollowUpScheduler();
    } catch (err) {
      console.error('   ⚠️ stopFollowUpScheduler failed:', err);
    }

    // 1. Close WhatsApp Socket
    console.log('   🔌 Disconnecting WhatsApp...');
    await disconnectWhatsApp();

    // 2. Close MongoDB
    if (mongoose.connection.readyState === 1) {
      console.log('   🍃 Closing MongoDB...');
      await mongoose.connection.close();
    }

    // 3. Close Server
    if (server) {
      console.log('   🔒 Closing HTTP Server...');
      server.close();
    }

    console.log('✅ Shutdown complete. Exiting.');
    process.exit(0);
  } catch (err: any) {
    if (!err?.message?.includes('buffering timed out')) {
      console.error('❌ Error during shutdown:', err?.message || err);
    }
    process.exit(0);
  }
};

// Handle process termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle ts-node-dev restart signal
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

// Global unhandled error handlers to prevent silent crashes
process.on('uncaughtException', (err: Error) => {
  console.error('🔥 FATAL UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error(
    '🔥 UNHANDLED PROMISE REJECTION at:',
    promise,
    '\nReason:',
    reason,
  );
});

startServer();

// Track last message time per user for auto-registration trigger
const lastMessageTime = new Map<string, number>();

// The resolved default tenant _id, cached at boot. Threaded into the agent
// orchestrator (metadata.tenantId) on the WhatsApp path so per-tenant skill
// injection, RAG retrieval, and lead tenant-stamping actually engage — they
// were dead before because the WhatsApp path never supplied a tenantId.
let defaultTenantId: string | null = null;
const AUTO_REG_DELAY_MS = 10 * 1000; // 10 seconds after last message
const AUTO_REG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup every hour
const AUTO_REG_ENTRY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // Remove entries older than 24 hours

// Track users who have opted out of auto-registration (in-memory cache).
// FIX H2: Set now has a hard cap (10 k entries) to prevent unbounded growth.
// Persistence for the !stop command is now also written to MongoDB via
// markContactOptedOut() so opt-outs survive server restarts.
const MAX_OPT_OUT_SIZE = 10_000;
const autoRegOptOut = new Set<string>();
function addToOptOut(jid: string): void {
  // Evict oldest entries when the cap is hit (insertion-order eviction)
  if (autoRegOptOut.size >= MAX_OPT_OUT_SIZE) {
    const oldest = autoRegOptOut.values().next().value;
    if (oldest) autoRegOptOut.delete(oldest);
  }
  autoRegOptOut.add(jid);
}

// De-duplication: guard against the SAME message being processed twice in a
// short window (Baileys can redeliver, and double-taps resend identical text).
// IMPORTANT: this must NOT drop *distinct* messages a customer sends quickly —
// people very often send "hi" then immediately "mata Japan job ekak ona". The
// old logic dropped every second message within 1s, silently losing real
// customer intent. We now only suppress an exact-duplicate (same text) from the
// same user inside the window; genuinely different messages always go through.
const lastMessageMap = new Map<string, { text: string; at: number }>();
const DUPLICATE_WINDOW_MS = 1500;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup every hour

// Check whether this is a redundant duplicate we should skip.
function isRateLimited(jid: string, text = ''): boolean {
  const now = Date.now();
  const prev = lastMessageMap.get(jid);
  const normalized = text.trim();

  const isDuplicate =
    !!prev &&
    now - prev.at < DUPLICATE_WINDOW_MS &&
    normalized !== '' &&
    prev.text === normalized;

  lastMessageMap.set(jid, { text: normalized, at: now });
  return isDuplicate;
}

// Cleanup de-dup entries periodically
const dedupCleanupTimer = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [jid, entry] of lastMessageMap.entries()) {
    if (now - entry.at > AUTO_REG_ENTRY_MAX_AGE_MS) {
      lastMessageMap.delete(jid);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} de-dup entries`);
  }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS);
dedupCleanupTimer.unref?.();

// Cleanup old entries periodically to prevent memory leak
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [jid, time] of lastMessageTime.entries()) {
    if (now - time > AUTO_REG_ENTRY_MAX_AGE_MS) {
      lastMessageTime.delete(jid);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(
      `🧹 Cleaned up ${cleaned} old auto-registration tracking entries`,
    );
  }
}, AUTO_REG_CLEANUP_INTERVAL_MS);

/**
 * Schedule auto-registration check after conversation ends
 * Waits for a delay after the last message, then triggers form if appropriate
 */
async function scheduleAutoRegistration(
  jid: string,
  sessionId: string,
): Promise<void> {
  const now = Date.now();
  lastMessageTime.set(jid, now);

  // Wait for the delay period
  await new Promise((resolve) => setTimeout(resolve, AUTO_REG_DELAY_MS + 1000));

  // Check if this is still the most recent message (no new messages came in)
  const lastTime = lastMessageTime.get(jid);
  if (lastTime !== now) {
    // User sent another message, abort this trigger
    return;
  }

  // Check if user has opted out of auto-registration
  if (autoRegOptOut.has(jid)) {
    return;
  }

  // Check if we should trigger auto-registration
  try {
    const template = await FormService.getActiveFormTemplate();
    if (!template) {
      // No active form template
      return;
    }

    // Check trigger mode
    if (template.triggerMode !== 'auto' && template.triggerMode !== 'both') {
      // Auto-trigger not enabled for this form
      return;
    }

    // Check if user already has an active session (AWAIT is required now)
    if (await FormService.hasActiveFormSession(jid)) {
      return;
    }

    // Check if user already submitted recently (last 24 hours)
    const FormSubmission = (await import('./models/FormSubmission')).default;
    const recentSubmission = await FormSubmission.findOne({
      phoneNumber: jid,
      submittedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    if (recentSubmission) {
      return;
    }

    // All conditions met - trigger the form
    console.log(`   📋 Auto-triggering registration form for ${jid}`);
    const result = await FormService.startFormSession(jid, jid);
    if (result.success && result.field) {
      const delay = template.triggerDelay || 10;
      // Wait for the configured delay before showing the form
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));

      // Double-check that no new messages came in during the delay
      const finalTime = lastMessageTime.get(jid);
      if (finalTime !== now) {
        return;
      }

      if (result.welcomeMessage) {
        await sendMessage(jid, result.welcomeMessage, sessionId);
      }
      const prompt = await FormService.getFieldPrompt(result.field);
      await sendMessage(jid, prompt, sessionId);
    }
  } catch (err) {
    console.error('   ⚠️ Auto-registration trigger error:', err);
  }
}

/**
 * Main message handler
 * Processes incoming messages and responds with AI
 */
onMessage(async (message, sock, sessionId) => {
  try {
    const jid = getSenderJid(message);
    // Guard against an empty/undefined sender JID — we use jid as a Map/Set key
    // (rate limiting, opt-out, auto-registration) so a blank key would corrupt
    // that state and address messages to nobody.
    if (!jid || !jid.trim()) {
      return;
    }
    let text = getMessageText(message);

    // Debug: Log incoming messages
    console.log(`📩 Message: "${text.substring(0, 50)}..." from ${jid}`);

    // Ignore the bot's own echoes FIRST — before the dedup map is touched —
    // so a fromMe echo can never populate lastMessageMap and shadow a
    // customer's later identical reply.
    if (isFromMe(message)) {
      console.log('   (Ignoring own message)');
      return;
    }

    // De-dup check — skip only an exact-duplicate resend, never a distinct
    // follow-up message (those carry real customer intent and must be handled).
    // For ANY media message, key on the unique message id, not the text —
    // otherwise two distinct photos sharing a caption (or two captionless
    // photos) would falsely dedupe as the "same message".
    const isMediaMsg = !!detectIncomingMedia(message);
    const dedupKey = isMediaMsg
      ? message.key?.id || ''
      : text || message.key?.id || '';
    if (isRateLimited(jid, dedupKey)) {
      console.log('   ⚡ Skipping exact-duplicate message');
      return;
    }

    // Update last message time for auto-registration
    lastMessageTime.set(jid, Date.now());

    // Auto-register new users in CRM (fire and forget - don't block message processing)
    const pushName =
      (message as any).pushName || (message.key as any)?.pushName;
    const phoneJidFromMsg = extractPhoneJidFromMessage(message);
    let inboundRealPhone =
      extractRealPhone(phoneJidFromMsg) ?? extractRealPhone(jid) ?? undefined;

    // ── Resolution layer 1: phone shared via a vCard contact card ────────
    // When the customer taps "Share my contact" in WhatsApp, the message
    // carries a `contactMessage` (or contactsArrayMessage) payload with a
    // vCard string. The vCard contains the real phone in TEL fields even
    // when the conversation JID is an opaque @lid. Extract once here so
    // every downstream consumer benefits — CRM auto-register, the chat
    // back-fill, exports — without each one re-parsing.
    const contactSharedPhone = extractPhoneFromContactCard(message);
    if (!inboundRealPhone && contactSharedPhone) {
      inboundRealPhone = contactSharedPhone;
    }

    rememberLidPhoneMapping({
      sessionId,
      lidJid: jid,
      phoneJid:
        phoneJidFromMsg ??
        (contactSharedPhone ? `${contactSharedPhone}@s.whatsapp.net` : null) ??
        extractPhoneFromText(text),
      source: contactSharedPhone ? 'phone_number_share' : 'message',
    }).catch((err) => {
      console.error('   ⚠️ LID phone mapping save error:', err);
    });

    // ── Resolution layer 2: verify any phone-shaped text via sock.onWhatsApp ─
    // The customer might type their number ("මගේ අංකය 0771234567") instead
    // of sharing a contact. extractPhoneFromText returns digits; that alone
    // doesn't prove they belong to this conversation, so we ask WhatsApp:
    // sock.onWhatsApp(['+94...']) returns { exists, jid, lid? } — only when
    // exists===true do we persist the mapping. Fire-and-forget: the result
    // helps the NEXT refresh, not this message.
    if (!inboundRealPhone) {
      const textPhone = extractPhoneFromText(text);
      if (textPhone && typeof (sock as any)?.onWhatsApp === 'function') {
        (sock as any)
          .onWhatsApp(`+${textPhone}`)
          .then(
            async (
              results: Array<{ exists?: boolean; jid?: string; lid?: string }>,
            ) => {
              const hit = (results ?? []).find((r) => r?.exists);
              if (!hit?.jid) return;
              const verifiedPhone = extractRealPhone(hit.jid);
              if (!verifiedPhone) return;
              // Persist both the LID we already have AND the LID Baileys
              // returns (some setups expose them as separate identifiers).
              const lidCandidates = [jid, hit.lid].filter(
                (v): v is string => typeof v === 'string' && v.length > 0,
              );
              for (const lid of lidCandidates) {
                await rememberLidPhoneMapping({
                  sessionId,
                  lidJid: lid,
                  phoneJid: `${verifiedPhone}@s.whatsapp.net`,
                  source: 'message',
                }).catch(() => undefined);
              }
              // Back-stamp realPhone on the message we just stored so the
              // chat list resolves immediately on the next refresh without
              // waiting for back-fill aggregation.
              await ChatMessage.updateMany(
                { userId: jid, 'metadata.realPhone': { $exists: false } },
                { $set: { 'metadata.realPhone': verifiedPhone } },
              ).catch(() => undefined);
            },
          )
          .catch((err: unknown) => {
            console.error('   ⚠️ sock.onWhatsApp reverse lookup failed:', err);
          });
      }
    }
    autoRegistrationService
      .checkAndRegister(
        jid,
        pushName,
        sessionId,
        inboundRealPhone,
        defaultTenantId || undefined,
      )
      .catch((err) => {
        console.error('   ⚠️ Auto-registration check error:', err);
      });

    // Enrich the existing Contact (if any) from this inbound message text —
    // fire-and-forget, never throws, never creates a Contact (registration
    // above owns creation). Chained .catch guarantees it can't crash the handler.
    enrichContactFromMessage({
      userId: jid,
      text,
      sessionId,
      tenantId: defaultTenantId || undefined,
      realPhone: inboundRealPhone,
    }).catch((err) => {
      console.warn('   ⚠️ Contact enrichment skipped:', err);
    });

    // Helper to extract audio message from various wrappers
    const getAudioMessage = (msg: any) => {
      if (!msg) return null;
      return (
        msg.audioMessage ||
        msg.ephemeralMessage?.message?.audioMessage ||
        msg.viewOnceMessage?.message?.audioMessage ||
        msg.viewOnceMessageV2?.message?.audioMessage ||
        msg.documentWithCaptionMessage?.message?.audioMessage
      );
    };

    const audioMsg = getAudioMessage(message.message);
    // Non-audio media (image / video / document / sticker) — detected here so
    // the empty-text guard below doesn't drop captionless attachments.
    const incomingMedia = audioMsg ? null : detectIncomingMedia(message);
    // The customer's OWN caption on a media message, captured before `text`
    // gets overwritten with the synthetic (English) analysis note — used for
    // language detection so we don't reply in English to a Sinhala/Tamil
    // customer who simply attached a photo.
    let mediaCaption = '';

    // Ignore empty messages (unless it's a voice or media message)
    if ((!text || text.trim() === '') && !audioMsg && !incomingMedia) {
      console.log('   (Ignoring empty message)');
      return;
    }

    // Ignore status broadcasts - only skip @broadcast addresses
    if (jid.includes('@broadcast')) {
      console.log('   (Ignoring broadcast message)');
      return;
    }

    // Opt-out / STOP keyword: a contact replying with STOP/UNSUBSCRIBE/etc.
    // is marked opted-out across every channel; outbound campaigns +
    // follow-ups skip them from then on. We send a single confirmation,
    // then short-circuit the rest of the flow — no AI, no upsell, no
    // form prompts to someone who just asked to be left alone.
    if (text && isStopKeyword(text)) {
      console.log(`   🚫 STOP keyword detected from ${jid}, marking opted-out`);
      try {
        // Use the RESOLVED real phone when we have it. For an @lid chat the
        // raw jid is opaque LID digits that never match the contact's real
        // phone/whatsappId, so a STOP opted out ZERO contacts while still
        // telling the user "you're unsubscribed" — and campaigns kept sending.
        // Fall back to the raw jid (markContactOptedOut also matches the full
        // JID string for LID-only contacts).
        const modified = await markContactOptedOut(
          inboundRealPhone ?? jid,
          'whatsapp',
          'inbound_stop_keyword',
        );
        console.log(`   ✅ Opted out ${modified} matching contact(s)`);
      } catch (err) {
        console.error('   ⚠️ markContactOptedOut failed:', err);
      }
      await sendMessage(
        jid,
        'ඔබව unsubscribe කර ඇත. තවදුරටත් අපෙන් marketing පණිවිඩ ලැබෙන්නේ නැත.\n\nYou have been unsubscribed. You will no longer receive marketing messages from us.',
        sessionId,
      );
      return;
    }

    let messageType: 'text' | 'voice' | 'image' | 'video' | 'document' | 'sticker' =
      'text';
    let detectedVoiceLanguage: string | null = null;

    // Helper to extract audio message from various wrappers

    // Check for Audio Message
    let isVoiceMessage = false;
    if (audioMsg) {
      messageType = 'voice';
      console.log('   🎤 Voice message detected! Downloading...');
      const audioBuffer = await downloadWhatsAppAudio(message);

      if (audioBuffer) {
        // Transcription — NEVER throws (voice.ts handles all failures gracefully)
        const transcriptionResult =
          await transcribeAudioWithLanguage(audioBuffer);

        if (
          !transcriptionResult.text ||
          transcriptionResult.text.trim().length < 2
        ) {
          console.warn(
            '   ⚠️ Transcription returned empty result — all STT providers failed',
          );
          // Language-aware "try again" messages
          const retryMessages: Record<string, string> = {
            si: '🎤 ඔබේ හඬ පණිවිඩය තේරුම් ගත නොහැකි විය. කරුණාකර නැවත උත්සාහ කරන්න.',
            ta: '🎤 உங்கள் குரல் செய்தி புரியவில்லை. மீண்டும் முயற்சிக்கவும்.',
            en: '🎤 Could not understand your voice message. Please speak clearly and try again.',
          };
          // Use Sinhala as default since most users are Sinhala
          await sendMessage(jid, retryMessages.si, sessionId);
          return;
        }

        console.log(
          `   📝 Transcription: "${transcriptionResult.text.substring(0, 80)}"`,
        );
        console.log(
          `   🌐 Language: ${transcriptionResult.detectedLanguage} (${(
            transcriptionResult.languageConfidence * 100
          ).toFixed(0)}%)`,
        );
        text = transcriptionResult.text;
        detectedVoiceLanguage = transcriptionResult.detectedLanguage;
        isVoiceMessage = true;
      } else {
        console.error('   ❌ Failed to download audio');
        return;
      }
    }

    // Check for image / video / document / sticker — download + Gemini
    // multimodal analysis so the agent can READ what the customer sent
    // (photos of certificates, CVs as PDFs, screenshots, voice-over videos)
    // instead of silently ignoring it. The analysis becomes part of `text`,
    // so every downstream consumer — flows, agents, AI load balancer,
    // conversation history — works unchanged.
    if (incomingMedia) {
      console.log(
        `   🖼️ ${incomingMedia.kind} message detected! Downloading + analyzing...`,
      );
      const analysis = await analyzeIncomingMedia(message, incomingMedia);
      if (analysis) {
        messageType = analysis.kind;
        mediaCaption = (text || '').trim();
        text = buildMediaPromptText(analysis);
        if (analysis.description) {
          console.log(
            `   📝 ${analysis.kind} analysis: "${analysis.description.substring(0, 80)}..."`,
          );
        } else {
          console.warn(
            `   ⚠️ ${analysis.kind} could not be analyzed — replying with graceful acknowledgement`,
          );
        }
      }
    }

    // [NEW] 1. Save USER Message to DB
    try {
      // Heuristic sentiment runs inline (sub-millisecond, zero cost). The
      // matched-term count is treated as a confidence proxy upstream — agents
      // can route low-confidence neutral messages to an LLM-backed scorer.
      const sentiment = scoreSentiment(text);

      // Fire-and-forget lead auto-tagging. Adds 'intent:*' tag to any Lead
      // matching this phone so the CRM/segment rule engine can filter by
      // inbound conversation signals without an extra scan. Failures are
      // swallowed — the message handler must never block on this.
      autoTagLeadFromMessage(jid.replace(/@.*/, ''), text).catch((err) => {
        console.error('   ⚠️ autoTagLeadFromMessage failed:', err);
      });

      // Always-on lead scoring: every inbound bumps engagement (and intent
      // when enrolment language appears) so the funnel can rank hot leads.
      // Fire-and-forget — must never block or break the reply path.
      leadScoringService
        .scoreInbound(jid.replace(/@.*/, ''), text, defaultTenantId || undefined)
        .catch((err) => console.error('   ⚠️ leadScoring failed:', err));
      // WhatsApp push name — store on the message so the chat list can
      // render a human-readable label even when the userId is a Linked-ID
      // (@lid) with no Contact match.

      // Resolve the real phone for this message. For `@lid` JIDs Baileys
      // 6.6+ exposes the underlying phone via `key.senderPn` /
      // `key.participantPn`; for classic `@s.whatsapp.net` JIDs we can
      // pull it from the JID itself. Stored on metadata so the chat list,
      // export and CRM lookups all converge on the same real number even
      // though `userId` stays as the raw JID (preserving the existing
      // aggregation contract).
      const savedMsg = await ChatMessage.create({
        userId: jid,
        role: 'user',
        type: messageType,
        content: text,
        // Stamp the tenant so chat-derived exports/analytics scope correctly.
        tenantId: defaultTenantId || undefined,
        // WhatsApp's own id — lets the history back-fill recognise a message
        // it already saw live instead of storing it a second time.
        waMessageId: message.key?.id || undefined,
        read: false, // User messages start as unread by admin
        metadata: {
          sessionId,
          isBooking: false,
          pushName,
          realPhone: inboundRealPhone,
          sentimentScore: sentiment.score,
          sentimentLabel: sentiment.label,
        },
      });

      // Emit to WebSocket for real-time dashboard
      try {
        const io = getIO();
        io.emit('new-message', savedMsg);
        console.log(`   📡 Emitted user message to live chat`);
      } catch (socketErr) {
        console.error(
          '   ⚠️ Failed to emit user message to socket:',
          socketErr,
        );
      }

      // [NEW] Trigger Webhook for incoming message. Scope to the tenant that
      // owns this message (the WhatsApp path uses the cached default tenant,
      // same value stamped on the ChatMessage above) so inbound-message PII
      // doesn't fan out to other tenants' webhook endpoints.
      WebhookService.triggerWebhook(
        'message.received',
        {
          id: savedMsg._id,
          from: jid,
          type: messageType,
          content: text,
          sessionId,
          timestamp: new Date(),
        },
        defaultTenantId || undefined,
      );
    } catch (dbErr) {
      console.error('   ❌ Failed to save user message:', dbErr);
    }

    // Global kill-switch: operator paused the bot (e.g. a reply loop). The
    // inbound message is already saved + shown in Live Chat above; skip ALL
    // automated handling so a human takes over. The device stays connected.
    if (isAiPaused()) {
      console.log('   ⏸️ AI auto-reply paused — skipping automated handling');
      return;
    }

    // 1. Check if user is in a booking flow
    const handledByBooking = await handleBookingMessage(jid, text, sessionId);
    if (handledByBooking) {
      console.log('   📅 Handled by BookingService');
      return;
    }

    // 2. Check if user is in lead registration flow
    const handledByLead = await handleLeadMessage(
      jid,
      text,
      sessionId,
      defaultTenantId || undefined,
    );
    if (handledByLead) {
      console.log('   📝 Handled by LeadService');
      return;
    }

    // 2.5. Check if user is in dynamic form flow
    if (await FormService.hasActiveFormSession(jid)) {
      console.log('   📋 Processing form field answer...');
      const result = await FormService.processFieldAnswer(jid, text);
      if (result.success) {
        if (result.isComplete) {
          await sendMessage(
            jid,
            result.completionMessage ||
              '✅ Thank you! Your registration has been submitted.',
            sessionId,
          );
        } else if (result.field) {
          const prompt = await FormService.getFieldPrompt(result.field);
          await sendMessage(jid, prompt, sessionId);
        }
      } else {
        await sendMessage(
          jid,
          result.message || 'Something went wrong. Please try again.',
          sessionId,
        );
        if (result.field) {
          const prompt = await FormService.getFieldPrompt(result.field);
          await sendMessage(jid, prompt, sessionId);
        }
      }
      return;
    }

    // Handle commands starting with !
    if (text.startsWith('!')) {
      console.log(`   🤖 Processing command: ${text}`);
      // FIX M4: Wrap command handler in try-catch so a failing command
      // never crashes the message handler — customer always gets a reply.
      try {
        await handleCommand(jid, text, sessionId, message);
      } catch (cmdErr) {
        console.error('   ❌ Command handler error:', cmdErr);
        await sendMessage(
          jid,
          '⚠️ Command failed. Please try again or type !help for available commands.',
          sessionId,
        ).catch(() => undefined);
      }
      return;
    }

    // Multi-agent orchestrator — runs only if specialist agents are registered
    // and pass their confidence threshold. Falls through to legacy AI fallback
    // on `no_handler`, so behaviour is unchanged until agents are wired in.
    try {
      const intent = classifyIntent(text);
      // FIX: Pass real conversation history so agents have context about this
      // user's prior messages (last 10 turns). Empty array meant every agent
      // call was "first message" — no personalisation, no BANT continuity.
      const agentHistory = await conversationHistoryService
        .getHistory(jid, defaultTenantId || undefined)
        .then((h) =>
          // Drop persisted system entries (personality/KB anchor written by
          // AILoadBalancer) — agents expect only genuine user/assistant turns.
          h
            .filter((m) => m.role !== 'system')
            .slice(-10)
            .map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
            })),
        )
        .catch(
          () =>
            [] as { role: 'user' | 'assistant' | 'system'; content: string }[],
        );

      // Detect the user's language up front so agents reply in the SAME
      // language the customer wrote in. Previously this was hardcoded to 'si',
      // so an English/Tamil customer handled by an agent got a Sinhala-biased
      // reply. Sinhala script → si, Tamil script → ta, real English words → en,
      // Singlish/unknown → si (the default market language).
      //
      // For media messages detect from the customer's OWN caption, NOT the
      // synthetic English analysis note now held in `text` (line 1017) — which
      // would otherwise force an English reply to a Sinhala/Tamil customer who
      // attached a photo/PDF. Mirrors the AI path's `langSource` handling.
      // Captionless media has an empty caption → falls through to the Sinhala
      // default.
      const agentLangSource = incomingMedia ? mediaCaption : text;
      const detectedAgentLanguage: 'si' | 'ta' | 'en' = /[඀-෿]/.test(
        agentLangSource,
      )
        ? 'si'
        : /[஀-௿]/.test(agentLangSource)
          ? 'ta'
          : isEnglishText(agentLangSource)
            ? 'en'
            : 'si';

      const agentOutcome = await agentOrchestrator.handle({
        sessionId,
        userId: jid,
        channel: 'whatsapp',
        language: detectedAgentLanguage,
        inputMessage: text,
        conversationHistory: agentHistory,
        metadata: {
          intent,
          // Supply the tenant so the orchestrator's skill-injection, RAG
          // retrieval, and the LeadQualifier lead tenant-stamping engage on the
          // WhatsApp path (previously omitted → all three were dead here).
          ...(defaultTenantId ? { tenantId: defaultTenantId } : {}),
        },
      });
      // FIX M1: Guard against null/undefined outcome before accessing properties.
      if (agentOutcome && agentOutcome.handled) {
        if (agentOutcome.outbound) {
          await HumanizerService.sendHumanizedMessage(
            jid,
            agentOutcome.outbound,
            sessionId,
          );
          console.log(
            `   🧠 Handled by agent: ${agentOutcome.agentName} (trace=${agentOutcome.traceId})`,
          );
          // FIX: Auto-trigger booking flow when DealAgent signals readiness.
          // Previously the shouldStartBookingFlow flag was written to sideEffects
          // but never consumed — the customer was primed to book but got no
          // booking form. Now we immediately start the BookingService flow so
          // the transition from "interested" to "booked" is seamless.
          const bookingIntent = agentOutcome.result?.sideEffects?.find(
            (e: any) =>
              e.kind === 'memory.write' &&
              e.payload?.tag === 'deal.booking_intent' &&
              e.payload?.shouldStartBookingFlow === true,
          );
          if (bookingIntent) {
            console.log(
              `   📅 DealAgent flagged booking intent — jumping to the date picker for ${jid}`,
            );
            // Go straight to the date picker (not the "Reply Yes" invitation):
            // the DealAgent already established intent conversationally. This is
            // the deterministic path that ends in a REAL Booking on the
            // Appointment Calendar + a REAL kiosk code — the agent itself never
            // "books" or invents a code.
            startBookingDatePicker(jid, sessionId).catch((err) =>
              console.error(
                '   ❌ Failed to start date picker from DealAgent signal:',
                err,
              ),
            );
          }
          return;
        }
        // Only suppress the AI fallback when an operator-approval queue
        // genuinely owns the response. Budget caps, agent errors and silent
        // agents must still let the user hear *something* back.
        if (agentOutcome.queuedForApproval) {
          console.log(
            `   🧠 Agent ${agentOutcome.agentName} queued for approval (trace=${agentOutcome.traceId})`,
          );
          return;
        }
        console.log(
          `   🧠 Agent ${agentOutcome.agentName} returned no outbound (reason=${agentOutcome.reason}, trace=${agentOutcome.traceId}) — falling back to AI`,
        );
      }
    } catch (err) {
      console.error(
        '   ❌ AgentOrchestrator error, falling back to legacy AI:',
        err,
      );
    }

    // For all other messages, respond with AI
    console.log('   💬 Processing as AI chat...');
    try {
      // Show typing indicator
      await sendTyping(jid, sessionId);

      // 3. New Lead & Intent Analysis
      // Only check if message contains date/time related keywords (performance optimization)
      // Fetch booking keywords from config (with fallback)
      const bookingKeywords = await configService.getBookingKeywords();
      const hasBookingKeyword = bookingKeywords.some((keyword) =>
        text.toLowerCase().includes(keyword),
      );

      if (hasBookingKeyword) {
        const leadAnalysis = await analyzeLeadIntent(text);
        if (
          leadAnalysis &&
          leadAnalysis.intent === 'Check Availability' &&
          leadAnalysis.bookingDetails?.date &&
          leadAnalysis.bookingDetails?.time
        ) {
          console.log(
            `   📅 Specific booking request: ${leadAnalysis.bookingDetails.date} @ ${leadAnalysis.bookingDetails.time}`,
          );
          await handleSpecificDateRequest(
            jid,
            leadAnalysis.bookingDetails.date,
            leadAnalysis.bookingDetails.time,
            sessionId,
          );
          return;
        }
      }

      // Get AI response (Using Load Balancer)
      let response: string | undefined;
      let intentAnalysis: any = null;
      let autoresearchIntent: string | null = null;

      try {
        // Autoresearch NLP Intent Classification (fast, under 200ms)
        try {
          const intentResult = await classifyMessage(text);
          autoresearchIntent = intentResult.intent;
          console.log(
            `   🤖 AutoresearchNLP: ${autoresearchIntent} (${(
              intentResult.confidence * 100
            ).toFixed(0)}%) in ${intentResult.inference_time_ms}ms`,
          );

          // Route based on intent - DISABLED FOR lead_register
          // Forms should ONLY trigger via !register command or explicit keyword
          if (
            autoresearchIntent === 'booking' &&
            intentResult.confidence > 0.85
          ) {
            console.log(
              '   📅 High-confidence booking intent detected via AutoresearchNLP',
            );
            await startBookingFlow(jid, sessionId);
            return;
          }
          // lead_register intent is DISABLED - use !register command instead
          // This prevents random chat messages from triggering the form
          // else if (autoresearchIntent === 'lead_register' && intentResult.confidence > 0.9) {
          //   console.log('   📝 High-confidence lead registration intent detected via AutoresearchNLP');
          //   await startLeadRegistration(jid, sessionId);
          //   return;
          // }
          else if (
            autoresearchIntent === 'greeting' &&
            intentResult.confidence > 0.85
          ) {
            console.log('   👋 Greeting detected via AutoresearchNLP');
            // Let AI handle greetings naturally
          }
        } catch (nlpErr) {
          console.log('   ⚠️ AutoresearchNLP unavailable, using fallback');
        }

        // NOTE: We deliberately do NOT call analyzeLeadIntent() here anymore.
        // It fired a FULL extra Gemini call on EVERY message purely to stamp
        // intent/buyingSignal metadata on the saved ChatMessage. On the Gemini
        // free tier (~10 req/min) that doubled our request rate and was a
        // primary cause of 429s that collapsed real replies into the canned
        // fallback template. The metadata is non-essential; it defaults to
        // 'General'/'None'. Specific booking date/time detection still runs
        // separately, but only when a booking keyword is present (above).
        intentAnalysis = null;

        // LANGUAGE DETECTION: Primary languages are Sinhala and Singlish
        // (Sinhala written in Latin letters). English replies are only
        // issued when the customer actually writes English \u2014 detected via
        // real English function words, not "is it Latin letters?" (which
        // previously misclassified Singlish as English and caused the bot
        // to reply in English to Sinhala-speaking customers).
        let finalPrompt = text;
        // For media messages, detect language from the customer's OWN caption,
        // NOT the synthetic English analysis note now held in `text` (which
        // would force English replies to Sinhala/Tamil customers). Captionless
        // media has no caption \u2192 falls through to the Sinhala/Singlish default.
        const langSource = incomingMedia ? mediaCaption : text;
        const hasSinhalaChars = /[\u0D80-\u0DFF]/.test(langSource);
        const hasTamilChars = /[\u0B80-\u0BFF]/.test(langSource);
        const isRealEnglish = isEnglishText(langSource);
        if (isVoiceMessage) {
          if (hasSinhalaChars) {
            finalPrompt += `\n\n(SYSTEM: මෙය VOICE පණිවිඩයකි. සිංහල භාෂාවෙන් කෙටිව, ස්වාභාවිකව ප්‍රතිඋත්තර දෙන්න.)`;
          } else if (hasTamilChars) {
            finalPrompt += `\n\n(SYSTEM: இது குரல் செய்தி. தமிழில் சுருக்கமாக, இயல்பாக பதிலளிக்கவும்.)`;
          } else if (isRealEnglish) {
            finalPrompt += `\n\n(SYSTEM: This is a VOICE message in English. Reply ONLY in English, short and natural.)`;
          } else {
            // Singlish or names/numbers — default to Sinhala, mirror Singlish style if user did.
            finalPrompt += `\n\n(SYSTEM: මෙය VOICE පණිවිඩයකි. පරිශීලකයා Singlish (සිංහල + ඉංග්‍රීසි අකුරු) හෝ සිංහල භාවිතා කරයි. සිංහල භාෂාවෙන් කෙටිව, ස්වාභාවිකව ප්‍රතිඋත්තර දෙන්න. පරිශීලකයා Singlish ලිවුවොත් එම ශෛලියට ගැලපීමට Singlish භාවිතා කරන්න. ඉංග්‍රීසි පමණක් භාවිතා නොකරන්න.)`;
          }
        } else {
          if (hasSinhalaChars) {
            finalPrompt += `\n\n(SYSTEM: සිංහල භාෂාවෙන් ප්‍රතිඋත්තර දෙන්න.)`;
          } else if (hasTamilChars) {
            finalPrompt += `\n\n(SYSTEM: தமிழ் மொழியில் பதிலளிக்கவும்.)`;
          } else if (isRealEnglish) {
            finalPrompt += `\n\n(SYSTEM: The user is writing in English. Reply ONLY in English.)`;
          } else {
            // Singlish or names/numbers — default to Sinhala, mirror Singlish style if user did.
            finalPrompt += `\n\n(SYSTEM: පරිශීලකයා Singlish (සිංහල + ඉංග්‍රීසි අකුරු) හෝ සිංහල භාවිතා කරයි. සිංහල භාෂාවෙන් ප්‍රතිඋත්තර දෙන්න. පරිශීලකයා Singlish ලිවුවොත් එම ශෛලියට ගැලපීමට Singlish භාවිතා කරන්න. ඉංග්‍රීසි පමණක් භාවිතා නොකරන්න.)`;
          }
        }

        // 4. AI Load Balancer (fallback chain). The Local NLP response cache
        // was permanently removed — every inbound message now reaches the AI
        // chain and the current AI_PERSONALITY prompt.
        if (!response) {
          response = await aiLoadBalancer.sendMessage(
            jid,
            finalPrompt,
            defaultTenantId || undefined,
          );

          // FIX C2: Handle "no services configured" error string from balancer
          if (!response || /no ai services are configured/i.test(response)) {
            response = await buildLeadFlowFallback(text, jid);
          }

          // FIX C2 (second guard): If fallback templates are also unconfigured
          // (buildLeadFlowFallback returns ''), set a hard-coded safe fallback
          // so the customer always gets a reply — never silence.
          if (!response || response.trim() === '') {
            response =
              'කරුණාකර ටිකක් ඉන්නකො. ඔබේ ප්‍රශ්නයට ඉක්මනින් පිළිතුරු දෙන්නම්. 🙏\n\n' +
              'Please hold on. We will reply to your message shortly.';
            console.warn(
              '⚠️ All AI providers and fallback templates failed — sending hardcoded safe reply',
            );
          }
        }

        // Simulate realistic typing delay
        const typingDelay = chatPersonality.getTypingDelay(
          response ? response.length : 0,
        );
        await new Promise((resolve) => setTimeout(resolve, typingDelay));
      } catch (aiError: any) {
        console.error('   ❌ Error in AI/NLP processing:', aiError);
        throw aiError;
      }

      console.log('   📤 Sending AI response...');

      // Check if response is empty and provide fallback
      if (!response || response.trim() === '') {
        await sendMessage(
          jid,
          '🙏 කරුණාකර නැවත උත්සාහ කරන්න. ඔබේ ප්‍රශ්නය මට තේරුම් ගන්න බැරි විය.',
          sessionId,
        );
        console.log('   ⚠️ Empty response from AI, sent fallback message');
        return;
      }

      // GUARDRAIL: the generic AI can also hallucinate a kiosk / voice-consult
      // code (it sees real ones in history/KB and imitates them). Strip any
      // fabricated code before sending — real codes only ever come from
      // BookingService's own confirmation, never this free-text path.
      response = sanitizeBookingReply(response);

      // Final outbound polish — guarantee clean, on-brand WhatsApp text for
      // every customer message (collapse stray markdown, trim, cap length).
      // Pure-code + fail-safe: never blanks a non-empty reply.
      response = messageQuality.clean(response);

      // Re-check empty: sanitizeBookingReply above can strip a reply down to ''
      // (e.g. a single hallucinated-code line). The guard at ~1518 ran BEFORE
      // that strip, so without this we'd send an empty message/TTS. Fall back.
      if (!response || response.trim() === '') {
        response =
          '🙏 කරුණාකර නැවත උත්සාහ කරන්න. ඔබේ ප්‍රශ්නය මට තේරුම් ගන්න බැරි විය.';
        console.log('   ⚠️ Reply blanked by sanitizer — using fallback');
      }

      // [NEW] 2. Save BOT Response to DB
      try {
        const savedBotMsg = await ChatMessage.create({
          userId: jid,
          role: 'assistant',
          type: 'text',
          content: response,
          // Stamp the tenant so chat-derived exports/analytics scope correctly.
          tenantId: defaultTenantId || undefined,
          read: true, // Bot messages are always considered "read" (from system)
          metadata: {
            sessionId,
            intent: intentAnalysis?.intent || 'General',
            buyingSignal: intentAnalysis?.buyingSignal || 'None',
          },
        });

        // Emit to WebSocket for real-time dashboard
        try {
          const io = getIO();
          io.emit('new-message', savedBotMsg);
          console.log(`   📡 Emitted bot message to live chat`);
        } catch (socketErr) {
          console.error(
            '   ⚠️ Failed to emit bot message to socket:',
            socketErr,
          );
        }
      } catch (dbErr) {
        console.error('   ❌ Failed to save bot response:', dbErr);
      }

      if (isVoiceMessage) {
        // FIX M14: Use cached voice config — avoids a MongoDB round-trip
        // on every voice message. Cache expires every 5 minutes.
        const voiceConfig = await getVoiceConfigCached();
        const responseMode = voiceConfig.mode;
        let sentText = false;

        // If mode requires text, send it first
        if (responseMode === 'text-only' || responseMode === 'voice-and-text') {
          sentText = await sendMessage(jid, response, sessionId);
          console.log('   ✅ AI text response sent (based on mode)');
        }

        // If mode requires voice, generate and send it
        if (
          responseMode === 'voice-only' ||
          responseMode === 'voice-and-text'
        ) {
          try {
            // Synthesize in the language the AI actually replied in — not a
            // hardcoded 'si'. Forcing Sinhala TTS made English/Tamil replies
            // read with a Sinhala voice (garbled audio); since the default
            // mode is voice-and-text, this hit every non-Sinhala voice user.
            // detectLanguage on the reply text is the most reliable signal.
            const voiceLang = detectLanguage(response).lang || 'si';
            console.log(
              `   🗣️ Generating voice response in language: ${voiceLang}...`,
            );
            const audioResponse = await generateSpeech(response, voiceLang);
            const voiceSent = await sendVoiceMessage(
              jid,
              audioResponse,
              sessionId,
            );
            if (voiceSent) {
              console.log('   ✅ AI voice response sent (based on mode)');
            } else {
              console.log('   ⚠️ Voice send returned false');
            }
          } catch (ttsError: any) {
            console.error('   ❌ TTS failed:', ttsError.message || ttsError);
            // Fallback if we didn't already send text
            if (!sentText) {
              await sendMessage(jid, response, sessionId);
            }
          }
        }
      } else {
        const sent = await sendMessage(jid, response, sessionId);
        if (sent) {
          console.log('   ✅ AI response sent');
        } else {
          console.log('   ❌ Failed to send response');
        }
      }

      // Auto-registration trigger: DISABLED by default
      // Forms should only be triggered via !register command or explicit NLP intent
      // Uncomment below if you want auto-registration after conversations
      // scheduleAutoRegistration(jid, sessionId).catch(err => {
      //   console.error('   ⚠️ Auto-registration check failed:', err);
      // });
    } catch (aiError: any) {
      console.error('   ❌ AI response error:', aiError.message || aiError);

      // Keep the customer-facing flow moving even when every AI provider fails
      // (e.g. all providers rate-limited / 429). buildLeadFlowFallback now
      // always returns a non-empty reply, but we guard with DEFAULT_SAFE_REPLY
      // so a thrown error here still never leaves the customer in silence.
      let fallbackResponse = DEFAULT_SAFE_REPLY;
      try {
        fallbackResponse =
          (await buildLeadFlowFallback(text, jid)) || DEFAULT_SAFE_REPLY;
      } catch (fbErr) {
        console.error(
          '   ❌ Fallback builder failed, using safe reply:',
          fbErr,
        );
      }
      await sendMessage(jid, fallbackResponse, sessionId);
    }
  } catch (error) {
    console.error('❌ Message handling error:', error);
  }
});

/**
 * Handle bot commands
 */
async function handleCommand(
  jid: string,
  text: string,
  sessionId: string,
  message: any,
): Promise<void> {
  const command = text.toLowerCase().split(' ')[0];

  // 1. Try to use the Command Dispatcher (for new class-based commands)
  const commandName = command.slice(1); // Remove '!'
  if (commandDispatcher.hasCommand(commandName)) {
    const args = text.split(' ').slice(1);
    await commandDispatcher.dispatch(commandName, message, args, sessionId);
    return;
  }

  // 2. Fallback to manual switch (legacy/script commands)
  switch (command) {
    case '!help': {
      // Build help message from dataset configuration
      const helpTemplate = await configurationManager.getHelpMessage();
      let helpMessage = '';

      if (helpTemplate.title) {
        helpMessage += `*${helpTemplate.title}*\n\n`;
      }
      if (helpTemplate.subtitle) {
        helpMessage += `${helpTemplate.subtitle}\n\n`;
      }
      if (helpTemplate.commands && helpTemplate.commands.length > 0) {
        helpMessage += '*Available Commands:*\n';
        helpTemplate.commands.forEach(
          (cmd: { command?: string; description?: string } | string) => {
            // Handle both object format {command, description} and string format
            if (typeof cmd === 'string') {
              helpMessage += `• ${cmd}\n`;
            } else if (cmd.command && cmd.description) {
              helpMessage += `• \`${cmd.command}\` - ${cmd.description}\n`;
            } else if (cmd.command) {
              helpMessage += `• ${cmd.command}\n`;
            }
          },
        );
        helpMessage += '\n';
      }
      if (helpTemplate.footer) {
        helpMessage += helpTemplate.footer;
      }

      // If nothing is configured, show warning
      if (!helpMessage.trim()) {
        helpMessage =
          '⚠️ Help message not configured. Please configure via Admin Panel > Datasets > HELP_MESSAGE';
      }

      await sendMessage(jid, helpMessage, sessionId);
      break;
    }

    case '!ping':
      await sendMessage(
        jid,
        await configurationManager.getPingMessage(),
        sessionId,
      );
      break;

    case '!clear':
      aiLoadBalancer.clearConversation(jid, defaultTenantId || undefined);
      await sendMessage(
        jid,
        await configurationManager.getClearMessage(),
        sessionId,
      );
      break;

    case '!stop':
    case '!unsubscribe': {
      // FIX H2 + #63: Always record the in-memory opt-out, then DURABLY persist
      // it to MongoDB BEFORE confirming the unsubscribe. We await the DB write so
      // the opt-out is saved before we tell the user they're unsubscribed. If the
      // write fails we still keep the in-memory opt-out, but warn the user that
      // the unsubscribe may not have fully saved.
      addToOptOut(jid);
      let optOutPersisted = true;
      try {
        await markContactOptedOut(jid, 'whatsapp', '!stop command');
      } catch (err) {
        optOutPersisted = false;
        console.error('   ⚠️ Failed to persist opt-out to MongoDB:', err);
      }
      let stopMessage = await configurationManager.getStopMessage();
      if (!optOutPersisted) {
        stopMessage +=
          '\n\n⚠️ Note: we could not fully save your request right now. Please send STOP again later if you keep receiving messages.';
      }
      await sendMessage(jid, stopMessage, sessionId);
      break;
    }

    case '!start':
    case '!subscribe':
      // Opt back in to auto-registration
      autoRegOptOut.delete(jid);
      await sendMessage(
        jid,
        await configurationManager.getStartMessage(),
        sessionId,
      );
      break;

    case '!register':
    case '!join':
    case '!apply':
      console.log('   📝 Starting registration flow...');
      // Try dynamic form first
      const formResult = await FormService.startFormSession(jid, jid);
      if (formResult.success) {
        if (formResult.welcomeMessage) {
          await sendMessage(jid, formResult.welcomeMessage, sessionId);
        }
        if (formResult.field) {
          const prompt = await FormService.getFieldPrompt(formResult.field);
          await sendMessage(jid, prompt, sessionId);
        }
      } else {
        // Fallback to legacy lead registration
        await startLeadRegistration(jid, sessionId);
      }
      break;

    case '!payment':
    case '!pay':
    case '!bank':
      console.log('   💳 Sending payment details...');
      // Extract argument if exists (e.g., "!payment singapore" -> "singapore")
      const paymentArg = text.split(' ').slice(1).join(' ');
      await sendMessage(
        jid,
        await configService.getPaymentMessage(paymentArg),
        sessionId,
      );
      break;

    case '!cv':
      console.log('   📄 Sending CV submission form...');
      await sendMessage(jid, await configService.getCVMessage(), sessionId);
      break;

    case '!jobs': {
      const jobsTemplate = await configurationManager.getJobsMessage();
      let jobsMessage = '';

      if (jobsTemplate.title) {
        jobsMessage += `*${jobsTemplate.title}*\n\n`;
      }

      if (jobsTemplate.jobs && jobsTemplate.jobs.length > 0) {
        jobsTemplate.jobs.forEach(
          (job: { emoji?: string; title: string; count?: string }) => {
            jobsMessage += `${job.emoji || '•'} *${job.title}*`;
            if (job.count) {
              jobsMessage += ` - ${job.count}`;
            }
            jobsMessage += '\n';
          },
        );
        jobsMessage += '\n';
      } else {
        jobsMessage += '⚠️ Jobs listing not configured.\n\n';
      }

      if (jobsTemplate.footer) {
        jobsMessage += jobsTemplate.footer;
      } else {
        jobsMessage += '📝 Type `!register` to apply.';
      }

      await sendMessage(jid, jobsMessage, sessionId);
      break;
    }

    case '!visit':
    case '!schedule':
    case '!appointment':
    case '!book':
      console.log('   📅 Starting booking flow...');
      await startBookingFlow(jid, sessionId);
      break;

    default:
      await sendMessage(
        jid,
        await configurationManager.getUnknownCommandMessage(command),
        sessionId,
      );
  }
}
