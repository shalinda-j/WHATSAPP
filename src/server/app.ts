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

const app = express();

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/datasets', datasetRoutes);
app.use('/api/sessions', sessionsRouter);
app.use('/api/config', configRouter);
app.use('/api/voice-config', voiceConfigRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/system', systemRouter);

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
