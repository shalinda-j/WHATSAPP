import express from 'express';
import cors from 'cors';
import { json } from 'body-parser';
import * as path from 'path';

// Routes
import authRoutes from './routes/auth';
import datasetRoutes from './routes/datasets';
import whatsappRoutes from './routes/whatsapp';
import configRoutes from './routes/config';
import sessionRoutes from './routes/sessions';

const app = express();

app.use(cors());
app.use(json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/datasets', datasetRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/config', configRoutes);
app.use('/api/sessions', sessionRoutes);

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
