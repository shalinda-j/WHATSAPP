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
import { seedAIProviders } from './services/AIProviderSeeder';
import { seedDatasets } from './services/DatasetSeeder';
import { seedDefaultFormTemplate } from './services/FormTemplateSeeder';
import {
  transcribeAudio,
  generateSpeech,
  transcribeAudioWithLanguage,
  detectLanguage,
} from './services/voice';
import { aiLoadBalancer } from './services/AILoadBalancer';
import { chatPersonality } from './services/ChatPersonality';
import { nlpService } from './services/NLPService';
import { autoresearchNLP, classifyMessage } from './services/autoresearchNLP';
import { analyzeLeadIntent } from './services/gemini';
import { WebhookService } from './services/WebhookService';
import { configService } from './services/ConfigService';
import { configurationManager } from './services/ConfigurationManagerService';
import {
  handleBookingMessage,
  startBookingFlow,
  handleSpecificDateRequest,
} from './services/BookingService';
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
import { usageResetService } from './services/UsageResetService';
import { agentOrchestrator } from './services/AgentOrchestrator';
import { agentReflectionService } from './services/AgentReflectionService';
import { registerCoreAgents } from './agents/bootstrap';
import { registerCoreChannels, channelRouter } from './channels';
import { classifyIntent } from './services/IntentClassifierService';
import { HumanizerService } from './services/HumanizerService';

const PORT = process.env.PORT || 8080;
let server: any;

async function startServer() {
  // 1. Connect to Database
  if (process.env.MONGODB_URI) {
    try {
      await connectToMongoDB(process.env.MONGODB_URI);
      // Seed AI providers from .env into the Config collection
      await seedAIProviders();
      await seedDatasets();
      await seedDefaultFormTemplate();
      await nlpService.initializeNLP();

      // CRITICAL: Clean up any old/stuck sessions on startup
      // This prevents old sessions from triggering forms unexpectedly
      const SessionState = (await import('./models/SessionState')).default;
      const result = await SessionState.deleteMany({});
      console.log(
        `🧹 Cleaned up ${result.deletedCount} old sessions on startup`,
      );

      // Start monthly usage reset scheduler
      usageResetService.start();

      // Start agent self-improvement scheduler (approval expiry + nightly promotion)
      agentReflectionService.start();

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
          const outcome = await agentOrchestrator.handle({
            sessionId: msg.tenantId,
            userId: msg.externalUserId,
            channel: msg.channel,
            language: 'si',
            inputMessage: msg.text ?? '',
            conversationHistory: [],
            metadata: { externalThreadId: msg.externalThreadId ?? '' },
          });
          if (outcome.handled && outcome.outbound) {
            await channelRouter.send({
              channel: msg.channel,
              tenantId: msg.tenantId,
              recipient: msg.externalThreadId ?? msg.externalUserId,
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
      await channelRouter.startAll(String(defaultTenant._id));

      // Boot the periodic campaign sender. Idempotent — only one timer
      // per process, automatically unref'd so it never blocks shutdown.
      const { startCampaignSender } =
        await import('./services/CampaignService');
      startCampaignSender(String(defaultTenant._id));

      // Boot the follow-up scheduler so FollowUpAgent fires on cron
      // against dormant leads (>= 5 days since last update).
      const { startFollowUpScheduler } =
        await import('./services/FollowUpScheduler');
      startFollowUpScheduler();
    } catch (dbErr) {
      console.error(
        '❌ MongoDB Connection Failed. Server starting in LIMITED MODE.',
      );
      console.error(dbErr);
    }
  } else {
    console.warn(
      '⚠️ No MONGODB_URI found. Some features (Admin Panel) may not work.',
    );
  }

  // 2. Start Admin API
  server = app.listen(PORT, () => {
    console.log(`🚀 Admin API Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  });

  // Initialize Socket.io
  initSocket(server);

  // 3. Connect to WhatsApp
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
const AUTO_REG_DELAY_MS = 10 * 1000; // 10 seconds after last message
const AUTO_REG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup every hour
const AUTO_REG_ENTRY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // Remove entries older than 24 hours

// Track users who have opted out of auto-registration
const autoRegOptOut = new Set<string>();

// Rate limiting: Track last processed message time per user
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 1000; // Minimum 1 second between messages per user
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup every hour

// Check if user is rate limited
function isRateLimited(jid: string): boolean {
  const now = Date.now();
  const lastTime = rateLimitMap.get(jid);

  if (lastTime && now - lastTime < RATE_LIMIT_MS) {
    return true;
  }

  rateLimitMap.set(jid, now);
  return false;
}

// Cleanup rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [jid, time] of rateLimitMap.entries()) {
    if (now - time > AUTO_REG_ENTRY_MAX_AGE_MS) {
      rateLimitMap.delete(jid);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} rate limit entries`);
  }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS);

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
    let text = getMessageText(message);

    // Debug: Log incoming messages
    console.log(`📩 Message: "${text.substring(0, 50)}..." from ${jid}`);

    // Rate limiting check - skip if user is sending messages too quickly
    if (isRateLimited(jid)) {
      console.log('   ⚡ Rate limited - skipping duplicate message');
      return;
    }

    // Update last message time for auto-registration
    lastMessageTime.set(jid, Date.now());

    // Ignore messages from self
    if (isFromMe(message)) {
      console.log('   (Ignoring own message)');
      return;
    }

    // Auto-register new users in CRM (fire and forget - don't block message processing)
    const pushName =
      (message as any).pushName || (message.key as any)?.pushName;
    autoRegistrationService
      .checkAndRegister(jid, pushName, sessionId)
      .catch((err) => {
        console.error('   ⚠️ Auto-registration check error:', err);
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

    // Ignore empty messages (unless it's a voice message)
    if ((!text || text.trim() === '') && !audioMsg) {
      console.log('   (Ignoring empty message)');
      return;
    }

    // Ignore status broadcasts - only skip @broadcast addresses
    if (jid.includes('@broadcast')) {
      console.log('   (Ignoring broadcast message)');
      return;
    }

    let messageType: 'text' | 'voice' = 'text';
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

    // [NEW] 1. Save USER Message to DB
    try {
      const savedMsg = await ChatMessage.create({
        userId: jid,
        role: 'user',
        type: messageType,
        content: text,
        read: false, // User messages start as unread by admin
        metadata: {
          sessionId,
          isBooking: false,
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

      // [NEW] Trigger Webhook for incoming message
      WebhookService.triggerWebhook('message.received', {
        id: savedMsg._id,
        from: jid,
        type: messageType,
        content: text,
        sessionId,
        timestamp: new Date(),
      });
    } catch (dbErr) {
      console.error('   ❌ Failed to save user message:', dbErr);
    }

    // 1. Check if user is in a booking flow
    const handledByBooking = await handleBookingMessage(jid, text, sessionId);
    if (handledByBooking) {
      console.log('   📅 Handled by BookingService');
      return;
    }

    // 2. Check if user is in lead registration flow
    const handledByLead = await handleLeadMessage(jid, text, sessionId);
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
      await handleCommand(jid, text, sessionId, message);
      return;
    }

    // Multi-agent orchestrator — runs only if specialist agents are registered
    // and pass their confidence threshold. Falls through to legacy AI fallback
    // on `no_handler`, so behaviour is unchanged until agents are wired in.
    try {
      const intent = classifyIntent(text);
      const agentOutcome = await agentOrchestrator.handle({
        sessionId,
        userId: jid,
        channel: 'whatsapp',
        language: 'si',
        inputMessage: text,
        conversationHistory: [],
        metadata: { intent },
      });
      if (agentOutcome.handled) {
        if (agentOutcome.outbound) {
          await HumanizerService.sendHumanizedMessage(
            jid,
            agentOutcome.outbound,
            sessionId,
          );
          console.log(
            `   🧠 Handled by agent: ${agentOutcome.agentName} (trace=${agentOutcome.traceId})`,
          );
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
      let answeredViaNLP = false;
      let autoresearchIntent: string | null = null;
      const responseLanguage = 'si'; // Default to Sinhala - accessible outside try block

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

        // Analyze Intent first for metadata
        intentAnalysis = await analyzeLeadIntent(text);

        // LANGUAGE DETECTION: Detect language and set response language accordingly
        // Default language is SINHALA. If user writes in English only, reply in English.
        let finalPrompt = text;
        if (isVoiceMessage) {
          const looksLikeEnglish =
            /^([a-zA-Z]+\s*){3,}$/.test(text.trim()) &&
            /\b(the|is|are|I|you|he|she|we|they|my|your|it|and|or|but|what|how|can|could|please|hello|hi|thank|yes|no|okay|ok)\b/i.test(
              text,
            );
          const hasSinhalaChars = /[\u0D80-\u0DFF]/.test(text);
          const hasTamilChars = /[\u0B80-\u0BFF]/.test(text);

          if (hasSinhalaChars) {
            finalPrompt += `\n\n(SYSTEM: මෙය VOICE පණිවිඩයකි. සිංහල භාෂාවෙන් කෙටිව, ස්වාභාවිකව ප්‍රතිඋත්තර දෙන්න.)`;
          } else if (hasTamilChars) {
            finalPrompt += `\n\n(SYSTEM: இது குரல் செய்தி. தமிழில் சுருக்கமாக, இயல்பாக பதிலளிக்கவும்.)`;
          } else if (looksLikeEnglish) {
            finalPrompt += `\n\n(SYSTEM: This is a VOICE message in English. Reply ONLY in English, short and natural.)`;
          } else {
            finalPrompt += `\n\n(SYSTEM: මෙය VOICE පණිවිඩයකි. සිංහල භාෂාවෙන් කෙටිව ප්‍රතිඋත්තර දෙන්න.)`;
          }
        } else {
          // Text message: detect language
          const hasSinhala = /[\u0D80-\u0DFF]/.test(text);
          const hasTamil = /[\u0B80-\u0BFF]/.test(text);
          const isLikelyEnglish =
            /^[a-zA-Z0-9\s\p{P}!?.,;&'"()+\-*#@%$^\[\]{}|\\/<>=`~]+$/u.test(
              text.trim(),
            );

          if (hasSinhala) {
            finalPrompt += `\n\n(SYSTEM: සිංහල භාෂාවෙන් ප්‍රතිඋත්තර දෙන්න.)`;
          } else if (hasTamil) {
            finalPrompt += `\n\n(SYSTEM: தமிழ் மொழியில் பதிலளிக்கவும்.)`;
          } else if (isLikelyEnglish) {
            finalPrompt += `\n\n(SYSTEM: The user is writing in English. Reply ONLY in English.)`;
          } else {
            finalPrompt += `\n\n(SYSTEM: Default language is Sinhala. සිංහල භාෂාවෙන් ප්‍රතිඋත්තර දෙන්න.)`;
          }
        }

        // 4. Local NLP Interception
        const isLocalNLPEnabled = await configService.getLocalNLPEnabled();
        if (isLocalNLPEnabled) {
          const nlpCacheResponse = await nlpService.processMessage(text);
          if (nlpCacheResponse) {
            response = nlpCacheResponse;
            answeredViaNLP = true;
            console.log('   ✅ Answered via Local NLP Cache');
          }
        }

        // 5. Fallback to AI Load Balancer if NLP doesn't know the answer
        if (!response) {
          response = await aiLoadBalancer.sendMessage(jid, finalPrompt);

          // Learn from AI response dynamically (Fire & Forget)
          if (isLocalNLPEnabled && response && response.trim() !== '') {
            nlpService.learnFromAI(text, response).catch((err) => {
              console.error('Failed to learn from AI:', err);
            });
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

      // [NEW] 2. Save BOT Response to DB
      try {
        const savedBotMsg = await ChatMessage.create({
          userId: jid,
          role: 'assistant',
          type: 'text',
          content: response,
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
        // Fetch Voice Config to respect the response mode
        // Default is 'voice-only' - when someone sends a voice note, reply with a voice note ONLY
        const voiceConfig = await VoiceConfig.findOne().sort({ updatedAt: -1 });
        const responseMode = voiceConfig?.mode || 'voice-only';
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
            console.log(
              `   🗣️ Generating voice response in language: ${responseLanguage}...`,
            );
            const audioResponse = await generateSpeech(
              response,
              responseLanguage,
            );
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

      // Check for quota/rate limit errors
      const errorMsg = aiError.message || '';
      if (errorMsg.includes('429') || errorMsg.includes('quota')) {
        await sendMessage(
          jid,
          '⚠️ *API Quota Exceeded*\n\nPlease try again in a minute.',
          sessionId,
        );
      } else {
        await sendMessage(
          jid,
          '⚠️ Sorry, I could not process your message.\nPlease try again or use `!help`',
          sessionId,
        );
      }
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
      aiLoadBalancer.clearConversation(jid);
      await sendMessage(
        jid,
        await configurationManager.getClearMessage(),
        sessionId,
      );
      break;

    case '!stop':
    case '!unsubscribe':
      // Opt out of auto-registration
      autoRegOptOut.add(jid);
      await sendMessage(
        jid,
        await configurationManager.getStopMessage(),
        sessionId,
      );
      break;

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
