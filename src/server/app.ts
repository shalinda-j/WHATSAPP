import express from 'express';
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
import formsRouter from './routes/forms';
import knowledgeRouter from './routes/knowledge';
import callAgentRouter from './routes/call-agent';
import agentsRouter from './routes/agents';
import channelsRouter from './routes/channels';
import oauthRouter from './routes/oauth';
import contentRouter from './routes/content';
import campaignsRouter from './routes/campaigns';
import segmentsRouter from './routes/segments';
import tenantsRouter from './routes/tenants';
import marketingInsightsRouter from './routes/marketingInsights';

import mongoose from 'mongoose';
import { authenticateToken } from './middleware/auth';

const app = express();

// Middleware
// CORS Configuration - Restrict to allowed origins
const allowedOrigins = [
  'http://localhost:5000', // Vite dev server
  'http://localhost:5173', // Vite default port
  'http://localhost:8080', // Backend server (same origin)
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
  // Add production origins here when deploying
  // 'https://your-domain.com',
];

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow: boolean) => void,
  ) => {
    // Allow requests with no origin (mobile apps, webhooks, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware: Check DB Connection with retry
app.use(async (req, res, next) => {
  // Allow auth, marketing, and inbound webhooks even without DB for testing/external integrations
  const allowedPaths = [
    '/api/auth',
    '/api/marketing',
    '/api/webhooks/inbound', // External systems need to send webhooks even without DB
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
app.use('/api/forms', authenticateToken, formsRouter);
app.use('/api/knowledge', authenticateToken, knowledgeRouter);
app.use('/api/call-agent', callAgentRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/channels', channelsRouter);
// OAuth lives under /api/auth/oauth — provider list is public so the
// Channels UI can show readiness state without holding an admin session.
app.use('/api/auth/oauth', oauthRouter);
app.use('/api/content', contentRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/segments', segmentsRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/marketing-insights', marketingInsightsRouter);

// Public forms endpoint (for bot)
app.use('/api/forms/default', async (req, res, next) => {
  // Bypass auth for default form
  next();
});

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
app.use(express.static(CLIENT_BUILD_PATH));

// SPA Fallback - Use middleware instead of route pattern for Express 5.x compatibility
app.use((req, res, next) => {
  // Skip API routes, static files, and health check
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/uploads') ||
    req.path === '/health'
  ) {
    return next();
  }
  // Serve index.html for SPA routes
  res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
});

export default app;
