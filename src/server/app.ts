import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as path from 'path';

// Routes
import authRoutes from './routes/auth';
import datasetRoutes from './routes/datasets';
import sessionsRouter from './routes/sessions';
import configRouter from './routes/config';
import configsRouter from './routes/configs';
import voiceConfigRouter from './routes/voice-config';
import webhookRouter from './routes/webhooks';
import whatsappRouter from './routes/whatsapp';
import systemRouter from './routes/system';
import companiesRouter from './routes/companies';
import bulkRouter from './routes/bulk';
import marketingRouter from './routes/marketing';
import leadsRouter from './routes/leads';
import analyticsRouter from './routes/analytics';
import crmRouter from './routes/crm';
import chatRouter from './routes/chat';
import workflowRouter from './routes/workflows';
import formsRouter, { defaultFormHandler } from './routes/forms';
import { standardRateLimit } from './middleware/rateLimit';
import knowledgeRouter from './routes/knowledge';
import callAgentRouter from './routes/call-agent';
import agentsRouter from './routes/agents';
import channelsRouter from './routes/channels';
import oauthRouter from './routes/oauth';
import contentRouter from './routes/content';
import agentTrainingRouter from './routes/agentTraining';
import voiceTelephonyRouter from './routes/voiceTelephony';
import agentSkillsRouter from './routes/agentSkills';
import conversionsRouter from './routes/conversions';
import campaignsRouter from './routes/campaigns';
import segmentsRouter from './routes/segments';
import tenantsRouter from './routes/tenants';
import marketingInsightsRouter from './routes/marketingInsights';
import auditRouter from './routes/audit';
import slaRouter from './routes/sla';
import exportsRouter from './routes/exports';
import kioskRouter from './routes/kiosk';
import voiceRouter from './routes/voice';
import kioskAdminRouter from './routes/kiosk-admin';
import { resolveTenant } from './middleware/tenantContext';

import mongoose from 'mongoose';
import { authenticateToken } from './middleware/auth';
import { auditLog } from './middleware/auditLog';

const app = express();

// Trust DigitalOcean's reverse proxy so req.ip and secure cookies work correctly
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
// CORS Configuration - Restrict to allowed origins.
// Production origins come from the ALLOWED_ORIGINS env var (comma-separated
// list, see .do/app.yaml). Without this the deployed admin panel calls
// were all rejected by CORS even though the env var was set.
const localOrigins = [
  'http://localhost:5000', // Vite dev server
  'http://localhost:5173', // Vite default port
  'http://localhost:8080', // Backend server (same origin)
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
];
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, '')) // strip trailing slash
  .filter((o) => o.length > 0);
const allowedOrigins = [...localOrigins, ...envOrigins];
if (envOrigins.length > 0) {
  console.log(`✅ CORS: allowed production origins → ${envOrigins.join(', ')}`);
}

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow: boolean) => void,
  ) => {
    // FIX M12: In production, only allow requests with a known origin.
    // Requests with no origin header (curl, Postman, server-to-server)
    // are allowed ONLY in development so operators can test locally.
    // In production this gate prevents CSRF-style tool-based abuse.
    if (!origin) {
      const isDev = process.env.NODE_ENV !== 'production';
      return callback(null, isDev);
    }

    // Normalise so "https://foo.com" and "https://foo.com/" both match.
    const normalised = origin.replace(/\/$/, '');
    if (allowedOrigins.includes(normalised)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked request from: ${origin}`);
      callback(null, false); // Don't throw error, just reject
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
// Body size limit is env-tunable (default 2mb). The `verify` callback stashes
// the exact received bytes on req.rawBody so webhook HMAC signatures can be
// computed over the original payload rather than a re-serialised JSON string.
const JSON_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';
app.use(
  express.json({
    limit: JSON_LIMIT,
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: JSON_LIMIT }));

// Middleware: Check DB Connection with retry
app.use(async (req, res, next) => {
  // Allow auth, marketing, and inbound webhooks even without DB for testing/external integrations
  const allowedPaths = [
    '/api/auth',
    '/api/marketing',
    '/api/webhooks/inbound', // External systems need to send webhooks even without DB
    '/api/webhooks/whatsapp-calling', // Live call events must answer even if DB is down
    '/api/bulk', // Bulk sender uses WhatsApp socket directly, not MongoDB
    '/api/call-agent', // Call agent settings now use file-system fallback
    '/api/voice-config', // Voice TTS config (graceful error if no DB)
    '/health', // Health check should always work
  ];

  if (allowedPaths.some((p) => req.path.startsWith(p))) {
    return next();
  }

  if (req.path.startsWith('/api')) {
    // If not connected, wait briefly for reconnection
    const initialReadyState = mongoose.connection.readyState as number;
    if (initialReadyState !== 1) {
      // Wait up to 2 seconds for connection
      const maxWait = 2000;
      const startTime = Date.now();
      let currentState: number = initialReadyState;

      while (Date.now() - startTime < maxWait && currentState !== 1) {
        await new Promise((r) => setTimeout(r, 100));
        currentState = mongoose.connection.readyState as number;
      }
    }

    // Check again after waiting
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message:
          'Database not connected. Please check server logs for connection errors (e.g., IP Whitelist).',
      });
    }
  }
  next();
});

// Audit middleware: records every mutating API call (POST/PUT/PATCH/DELETE)
// to the AuditEvent collection. Hooked via res.on('finish') so it adds zero
// blocking latency and never rejects a legitimate call even if Mongo writes
// fail. Sensitive request-body fields are redacted before persistence.
// MUST be registered BEFORE the API route mounts: route handlers terminate
// the request (res.json/res.send) and never call next(), so a post-routes
// registration never executes. Running it here attaches the res.on('finish')
// hook before each handler runs, while still capturing the final statusCode,
// tenant and user once auth/resolveTenant/handler have populated them.
app.use(auditLog);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRouter); // Webhooks manage their own security

// Protected Routes
app.use('/api/datasets', authenticateToken, datasetRoutes);
app.use('/api/sessions', authenticateToken, sessionsRouter);
app.use('/api/config', authenticateToken, configRouter);
app.use('/api/configs', authenticateToken, configsRouter);
app.use('/api/voice-config', authenticateToken, voiceConfigRouter);
app.use('/api/whatsapp', authenticateToken, whatsappRouter);
app.use('/api/system', authenticateToken, systemRouter);
app.use('/api/bulk', authenticateToken, bulkRouter);
app.use('/api/companies', authenticateToken, companiesRouter);
app.use('/api/marketing', authenticateToken, marketingRouter);
app.use('/api/leads', authenticateToken, leadsRouter);
app.use('/api/analytics', authenticateToken, analyticsRouter);
app.use('/api/crm', authenticateToken, crmRouter);
app.use('/api/chat', authenticateToken, chatRouter);
app.use('/api/workflows', authenticateToken, workflowRouter);
// PUBLIC default-form route for the bot — MUST be registered BEFORE the
// authenticated `/api/forms` mount below. Express matches in order, so this
// exact-path GET serves /api/forms/default without a token, while every other
// /api/forms/* path falls through to the authenticated router. (The old
// `app.use('/api/forms/default', next)` bypass was dead code: it sat AFTER the
// authenticated mount, which had already 401'd unauthenticated callers.)
app.get('/api/forms/default', standardRateLimit, defaultFormHandler);
app.use('/api/forms', authenticateToken, formsRouter);
app.use('/api/knowledge', authenticateToken, knowledgeRouter);
app.use('/api/call-agent', callAgentRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/channels', channelsRouter);
// OAuth lives under /api/auth/oauth — provider list is public so the
// Channels UI can show readiness state without holding an admin session.
app.use('/api/auth/oauth', oauthRouter);
app.use('/api/content', contentRouter);
app.use('/api/agent-training', agentTrainingRouter);
app.use('/api/voice-telephony', voiceTelephonyRouter);
app.use('/api/agent-skills', agentSkillsRouter);
app.use('/api/conversions', conversionsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/segments', segmentsRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/marketing-insights', marketingInsightsRouter);
app.use('/api/audit', authenticateToken, resolveTenant, auditRouter);
app.use('/api/sla', authenticateToken, resolveTenant, slaRouter);
app.use('/api/export', authenticateToken, resolveTenant, exportsRouter);

// Kiosk: PUBLIC router — no authenticateToken here. It enforces its own
// short-lived kiosk-token middleware (x-kiosk-token / Bearer) on the
// protected sub-routes (/consult, /convert); /session is intentionally open.
app.use('/api/kiosk', kioskRouter);
// Admin-only STT utility + kiosk invite issuance.
app.use('/api/voice', authenticateToken, voiceRouter);
app.use('/api/kiosk-admin', authenticateToken, resolveTenant, kioskAdminRouter);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Global Error Handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error('🔥 Global API Error:', err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: 'Internal Server Error', message: err.message });
    }
  },
);

// Health check with database status
app.get('/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const dbStatusMap: Record<number, string> = {
    [mongoose.ConnectionStates.disconnected]: 'disconnected',
    [mongoose.ConnectionStates.connected]: 'connected',
    [mongoose.ConnectionStates.connecting]: 'connecting',
    [mongoose.ConnectionStates.disconnecting]: 'disconnecting',
  };

  const health: any = {
    status: 'ok',
    service: 'whatsapp-bot-admin-api',
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatusMap[dbStatus] || 'unknown',
      readyState: dbStatus,
    },
  };

  // If database is connected, add extra info
  if (
    dbStatus === mongoose.ConnectionStates.connected &&
    mongoose.connection.db
  ) {
    try {
      const adminDb = mongoose.connection.db.admin();
      const serverInfo = await adminDb.serverInfo();
      health.database.version = serverInfo.version;
      health.database.name = mongoose.connection.name;
      health.database.host = mongoose.connection.host;
    } catch (e) {
      health.database.warning = 'Could not fetch server info';
    }
  }

  // Enrich with per-channel + agent readiness when DB is up. This is what
  // the operator's deploy health-check should green on — not just Mongo
  // connectivity but the actual end-to-end serving surface.
  if (
    dbStatus === mongoose.ConnectionStates.connected &&
    mongoose.connection.db
  ) {
    try {
      const { channelRouter } = await import('../channels');
      const Tenant = (await import('../models/Tenant')).default;
      const AgentConfig = (await import('../models/AgentConfig')).default;
      const defaultTenant = await Tenant.findOne({ slug: 'default' });
      const channelStatuses: Record<string, unknown> = {};
      if (defaultTenant) {
        for (const ch of channelRouter.list()) {
          const adapter = channelRouter.get(ch);
          if (!adapter) continue;
          try {
            const s = await adapter.status(String(defaultTenant._id));
            channelStatuses[ch] = {
              connected: s.connected,
              detail: s.detail,
            };
          } catch (e: any) {
            channelStatuses[ch] = { connected: false, detail: e?.message };
          }
        }
      }
      health.channels = channelStatuses;

      const agents = await AgentConfig.find(
        {},
        { name: 1, mode: 1, isActive: 1 },
      );
      health.agents = {
        total: agents.length,
        autonomous: agents.filter((a) => a.isActive && a.mode === 'autonomous')
          .length,
        approval: agents.filter((a) => a.isActive && a.mode === 'approval')
          .length,
        disabled: agents.filter((a) => !a.isActive || a.mode === 'disabled')
          .length,
        names: agents.map((a) => ({
          name: a.name,
          mode: a.mode,
          active: a.isActive,
        })),
      };

      // AI provider readiness — proves the live deployment loaded SUPPORTED
      // models (e.g. gemini-2.5-flash, not the paid-only gemini-3.x that 429s
      // and collapses every reply into the canned template). Lets the deploy
      // be verified from outside without sending a real WhatsApp message.
      try {
        const { aiLoadBalancer } = await import('../services/AILoadBalancer');
        const providers = await aiLoadBalancer.getLoadedProviderInfo();
        health.ai = {
          providerCount: providers.length,
          providers,
          usesUnsupportedModel: providers.some((p) =>
            /^gemini-(1\.0|1\.5|2\.0|3)/i.test(p.model),
          ),
        };
      } catch (aiErr: any) {
        health.ai = { error: aiErr?.message ?? 'ai diagnostics threw' };
      }

      // Voice / TTS readiness — proves the AI Voice Consultant kiosk can
      // actually synthesize speech via OpenRouter (API key + model resolvable)
      // without needing a live kiosk session. `hasKey` is a boolean — it never
      // exposes the key itself.
      try {
        const { getOpenRouterVoiceSettings } = await import(
          '../services/openrouterVoice'
        );
        const v = await getOpenRouterVoiceSettings();
        health.voice = {
          openrouterTts: {
            ready: !!v.apiKey,
            hasKey: !!v.apiKey,
            model: v.model,
            voice: v.voice,
          },
        };
      } catch (vErr: any) {
        health.voice = { error: vErr?.message ?? 'voice diagnostics threw' };
      }
    } catch (e: any) {
      health.diagnosticsError = e?.message ?? 'health diagnostics threw';
    }
  }

  // Return 503 if database is not connected
  if (dbStatus !== mongoose.ConnectionStates.connected) {
    return res.status(503).json({
      ...health,
      status: 'degraded',
      message: 'Database not connected. Some features may not work.',
    });
  }

  res.json(health);
});

// Serve Frontend
const CLIENT_BUILD_PATH = path.join(__dirname, '../../client/dist');
// Hashed assets are immutable — safe to cache forever. index.html below is
// served with no-cache so the browser always learns the new asset hashes
// after a deploy.
app.use(
  express.static(CLIENT_BUILD_PATH, {
    maxAge: '1y',
    immutable: true,
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        // Note: the Clear-Site-Data one-shot purge is applied in the
        // SPA fallback below (which has access to req for the cookie
        // check). express.static's setHeaders callback only sees (res,
        // path) so we can't do cookie-conditional headers here.
      }
    },
  }),
);

/**
 * One-shot site-data purge: when a browser arrives without the `_bv`
 * cookie we attach `Clear-Site-Data: "cache"` to the HTML response and
 * set the cookie to prevent it firing again on subsequent visits.
 *
 * This is the recovery path for users who are *currently* holding a
 * stale `index.html` from before PR #16/#35/#36 shipped — once they
 * hit the server again and get a fresh response with this header,
 * their browser drops every cached asset for the origin and re-fetches
 * everything cleanly. The cookie is `_bv=v2` (bumped when we need to
 * force another purge in the future) with a 1-year max-age.
 *
 * After the first visit the cookie is set, so the long-lived immutable
 * caching of hashed assets (from PR #17) keeps working — no
 * performance penalty on steady-state.
 */
const SITE_DATA_PURGE_VERSION = 'v2';
function applyBundleRecoveryHeaders(req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  const cookieHeader = req.headers.cookie || '';
  const purgeCookieRe = new RegExp(
    '(?:^|;\\s*)_bv=' + SITE_DATA_PURGE_VERSION + '(?:;|$)',
  );
  if (!purgeCookieRe.test(cookieHeader)) {
    res.setHeader('Clear-Site-Data', '"cache"');
    res.setHeader(
      'Set-Cookie',
      `_bv=${SITE_DATA_PURGE_VERSION}; Max-Age=31536000; Path=/; SameSite=Lax`,
    );
  }
}

// SPA Fallback - Use middleware instead of route pattern for Express 5.x compatibility
app.use((req, res, next) => {
  // Skip API routes, uploads and health check entirely.
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/uploads') ||
    req.path === '/health'
  ) {
    return next();
  }

  // CRITICAL: never serve index.html for a missing asset. Vite hashes every
  // asset URL, so a request for /assets/<hash>.js with no matching file on
  // disk means the browser has cached a stale index.html. Returning the
  // SPA shell here triggers "Failed to load module script" because the JS
  // bundle is silently replaced by HTML. Surface a real 404 instead so the
  // browser errors loudly and a hard refresh picks up the new hash.
  if (req.path.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(req.path)) {
    return next();
  }

  // For all other paths (real SPA routes like /dashboard, /channels), serve
  // index.html so React Router takes over. Don't cache — the asset hashes
  // inside change every deploy.
  // One-shot Clear-Site-Data purge (cookie-gated) + no-store on the HTML.
  // After the first visit the `_bv` cookie suppresses the purge so
  // long-lived immutable caching of hashed assets keeps working.
  applyBundleRecoveryHeaders(req, res);
  res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
});

// Global error handler — MUST be registered AFTER all routes. Without this,
// any thrown error inside an async route handler causes Express 5 to send
// its default HTML error page, which the browser sees as a corrupted
// response (often surfacing as ERR_CONNECTION_CLOSED depending on timing).
// This handler ensures every API failure becomes a clean JSON 500 the
// frontend can render instead of silently dying.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  // Don't double-respond if a handler already partially wrote a response.
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error(`❌ Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({
    error: 'internal_error',
    message,
    path: req.originalUrl,
  });
});

export default app;
