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

import mongoose from 'mongoose';
import { authenticateToken } from './middleware/auth';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware: Check DB Connection with retry
app.use(async (req, res, next) => {
  // Allow auth, marketing, and inbound webhooks even without DB for testing/external integrations
  const allowedPaths = [
    '/api/auth',
    '/api/marketing',
    '/api/webhooks/inbound', // External systems need to send webhooks even without DB
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

// SPA Fallback
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
});

export default app;
