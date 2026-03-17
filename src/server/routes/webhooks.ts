import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import Webhook from '../../models/Webhook';
import { sendMessage, getSocket } from '../../services/whatsapp';
import { WebhookService } from '../../services/WebhookService';

const router = express.Router();

// --- INBOUND ---

// Handle Inbound Webhook (External System -> Bot)
// This endpoint is designed for external systems to trigger actions
router.post('/inbound', async (req, res) => {
  try {
    const { event, payload, secret, sessionId } = req.body;

    console.log(`🪝 Inbound webhook received: ${event}`);

    // Basic Secret Validation (Optional but recommended)
    // Real implementation should verify signature if high security needed
    // For now, we assume simple secret token match if provided
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid secret' });
    }

    // Handle different event types
    switch (event) {
      case 'send_message': {
        const { to, message } = payload;
        if (!to || !message) {
          return res
            .status(400)
            .json({ error: 'Missing "to" or "message" in payload' });
        }

        // Check if WhatsApp is connected
        const sock = getSocket(sessionId || 'default');
        if (!sock) {
          return res.status(503).json({
            error: 'WhatsApp not connected',
            message:
              'The WhatsApp session is not currently active. Please try again later.',
          });
        }

        const sent = await sendMessage(to, message, sessionId || 'default');
        if (sent) {
          return res.json({ success: true, message: 'Message queued' });
        } else {
          return res.status(500).json({ error: 'Failed to send message' });
        }
      }

      case 'ping': {
        // Health check event - always responds with pong
        return res.json({
          success: true,
          message: 'pong',
          timestamp: new Date().toISOString(),
          whatsapp: getSocket(sessionId || 'default')
            ? 'connected'
            : 'disconnected',
        });
      }

      case 'status': {
        // Status check event - returns system status
        const sock = getSocket(sessionId || 'default');
        return res.json({
          success: true,
          status: {
            whatsapp: sock ? 'connected' : 'disconnected',
            timestamp: new Date().toISOString(),
          },
        });
      }

      default:
        // Unknown event - acknowledge receipt
        console.log(`   ℹ️ Unknown event type: ${event}`);
        return res.json({ success: true, message: 'Event received', event });
    }
  } catch (error: any) {
    console.error('Inbound webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- CRUD for Admin Panel ---

// Get all webhooks
router.get('/', async (req, res) => {
  try {
    const webhooks = await (Webhook as any).find().sort({ createdAt: -1 });
    res.json(webhooks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new webhook
router.post('/', async (req, res) => {
  try {
    const webhook = new (Webhook as any)(req.body);
    await webhook.save();
    res.status(201).json(webhook);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Update webhook
router.put('/:id', async (req, res) => {
  try {
    const webhook = await (Webhook as any).findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
      },
    );
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    res.json(webhook);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete webhook
router.delete('/:id', async (req, res) => {
  try {
    const webhook = await (Webhook as any).findByIdAndDelete(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ message: 'Webhook deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Test webhook
router.post('/:id/test', async (req, res) => {
  try {
    const webhook = await (Webhook as any).findById(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    // This is a bit of a hack to use the private sendPayload method by exposing a test mechanism
    // For cleaner code, we can just use axios directly here or add a public method to WebhookService
    const testPayload = {
      id: 'test_123',
      from: 'Test User',
      type: 'test',
      content: 'This is a test webhook payload from the dashboard',
      sessionId: 'default',
      timestamp: new Date(),
    };

    try {
      const data = {
        event: 'test.ping',
        timestamp: new Date().toISOString(),
        payload: testPayload,
      };

      const headers: any = {
        'Content-Type': 'application/json',
        'User-Agent': 'Jayalath-Bot/1.0',
        'X-Webhook-Event': 'test.ping',
      };

      if (webhook.secret) {
        const signature = crypto
          .createHmac('sha256', webhook.secret)
          .update(JSON.stringify(data))
          .digest('hex');
        headers['X-Hub-Signature'] = `sha256=${signature}`;
      }

      await axios.post(webhook.url, data, { headers, timeout: 5000 });
      res.json({ success: true, message: 'Test webhook sent successfully' });
    } catch (axiosError: any) {
      console.error('Test webhook failed:', axiosError.message);
      res.status(400).json({ error: `Webhook failed: ${axiosError.message}` });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
