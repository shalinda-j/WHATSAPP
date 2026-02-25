import express from 'express';
import cors from 'cors';
import * as path from 'path';

// Routes
import authRoutes from './routes/auth';
import datasetRoutes from './routes/datasets';
import sessionsRouter from './routes/sessions';
import configRouter from './routes/config';
import voiceConfigRouter from './routes/voice-config';
import webhookRouter from './routes/webhooks';
import whatsappRouter from './routes/whatsapp';
import systemRouter from './routes/system';
import companiesRouter from './routes/companies';
import bulkRouter from './routes/bulk';
import marketingRouter from './routes/marketing';
import leadsRouter from './routes/leads';
import analyticsRouter from './routes/analytics';

import mongoose from 'mongoose';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware: Check DB Connection
app.use((req, res, next) => {
  // Allow auth and marketing endpoints even without DB for testing
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/marketing')) {
    return next();
  }
  if (req.path.startsWith('/api') && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Database not connected. Please check server logs for connection errors (e.g., IP Whitelist).'
    });
  }
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/datasets', datasetRoutes);
app.use('/api/sessions', sessionsRouter);
app.use('/api/config', configRouter);
app.use('/api/voice-config', voiceConfigRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/system', systemRouter);
app.use('/api/bulk', bulkRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/marketing', marketingRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/analytics', analyticsRouter);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('🔥 Global API Error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-bot-admin-api' });
});

// Serve Frontend
const CLIENT_BUILD_PATH = path.join(__dirname, '../../client/dist');
app.use(express.static(CLIENT_BUILD_PATH));

// SPA Fallback
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
});

export default app;
