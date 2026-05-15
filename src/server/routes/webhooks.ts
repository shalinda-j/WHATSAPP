import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import Webhook from '../../models/Webhook';
import { sendMessage, getSocket } from '../../services/whatsapp';
import { WebhookService } from '../../services/WebhookService';
import { configurationManager } from '../../services/ConfigurationManagerService';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// --- INBOUND ---
// Note: /inbound endpoint remains public for external systems to trigger actions
// but requires WEBHOOK_SECRET validation for security

// Handle Inbound Webhook (External System -> Bot)
// This endpoint is designed for external systems to trigger actions
router.post('/inbound', async (req, res) => {
  try {
    const { event, payload, secret, sessionId } = req.body;

    console.log(`🪝 Inbound webhook received: ${event}`);

    // Basic Secret Validation (Optional but recommended)
    // Real implementation should verify signature if high security needed
    // Using crypto.timingSafeEqual to prevent timing attacks when comparing secrets
    if (process.env.WEBHOOK_SECRET) {
      if (!secret || typeof secret !== 'string') {
        return res.status(401).json({ error: 'Invalid secret' });
      }

      const expectedSecret = process.env.WEBHOOK_SECRET;
      const expectedHash = crypto
        .createHash('sha256')
        .update(expectedSecret)
        .digest();
      const providedHash = crypto.createHash('sha256').update(secret).digest();

      if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
        return res.status(401).json({ error: 'Invalid secret' });
      }
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

// --- Channel inbound webhooks (public; per-adapter signature/secret check) ---
//
// Telegram webhook: when the operator prefers webhook mode over long-poll
// (e.g. serverless deployments), they configure the bot's webhook URL on
// Telegram pointing at /api/webhooks/telegram/:tenantSlug. We verify the
// X-Telegram-Bot-Api-Secret-Token header against the stored ChannelConnection
// to defend against unauthenticated webhook spam.
router.post('/telegram/:tenantSlug', async (req, res) => {
  try {
    const { tenantSlug } = req.params;
    const Tenant = (await import('../../models/Tenant')).default;
    const ChannelConnection = (await import('../../models/ChannelConnection'))
      .default;
    const { channelRouter } = await import('../../channels');

    const tenant = await Tenant.findOne({ slug: tenantSlug });
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });
    const conn = await ChannelConnection.findOne({
      tenantId: tenant._id,
      channel: 'telegram',
    });
    if (!conn) return res.status(404).json({ error: 'connection_not_found' });

    const expectedSecret = (conn.config as any)?.webhookSecret as
      | string
      | undefined;
    if (expectedSecret) {
      const got = req.headers['x-telegram-bot-api-secret-token'] as
        | string
        | undefined;
      if (!got || got !== expectedSecret) {
        return res.status(401).json({ error: 'bad_secret' });
      }
    }

    // Pipe into channelRouter inbound dispatch through the same path
    // the long-poller uses. We do this by surfacing an InboundMessage
    // directly to handlers — no need to expose the channelRouter
    // internal API.
    const update = req.body;
    const message = update?.message;
    if (message) {
      // Use the orchestrator path directly so this works even if the
      // TelegramAdapter for this tenant wasn't long-polling. Same
      // shape the channelRouter inbound handler builds in src/index.ts.
      const { agentOrchestrator } =
        await import('../../services/AgentOrchestrator');
      const text = typeof message.text === 'string' ? message.text : '';
      const externalUserId = String(message.from?.id ?? '');
      const externalThreadId = String(message.chat?.id ?? '');
      try {
        const outcome = await agentOrchestrator.handle({
          sessionId: String(tenant._id),
          userId: externalUserId,
          channel: 'telegram',
          language: tenant.brand?.primaryLanguage ?? 'si',
          inputMessage: text,
          conversationHistory: [],
          metadata: { externalThreadId },
        });
        if (outcome.handled && outcome.outbound) {
          await channelRouter.send({
            channel: 'telegram',
            tenantId: String(tenant._id),
            recipient: externalThreadId,
            text: outcome.outbound,
          });
        }
      } catch (err) {
        console.error('telegram webhook orchestrator failed:', err);
      }
    }
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('telegram webhook error:', err);
    return res.status(500).json({ error: err?.message ?? 'server_error' });
  }
});

// SendGrid event webhook: delivery / bounce / open / click / spam reports
// arrive here in batches. We map externalMessageId → CampaignExecution
// row → update its status so the marketing insights pipeline sees real
// delivery + reply rates instead of just queue → sent counts.
//
// SendGrid sends a JSON array; each event has sg_message_id (matches our
// stored externalMessageId), event ('delivered' / 'bounce' / 'open' /
// 'click' / 'spamreport' / 'dropped' / 'deferred'), and a timestamp.
router.post('/sendgrid', async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [];
    const CampaignExecution = (await import('../../models/CampaignExecution'))
      .default;

    for (const ev of events) {
      const sgId = ev?.sg_message_id as string | undefined;
      if (!sgId) continue;
      // SendGrid's sg_message_id format: '<base>.<delivery-uuid>'.
      // Our stored externalMessageId is the X-Message-Id header which
      // is the same base prefix.
      const base = sgId.split('.')[0];

      const update: Record<string, unknown> = {};
      const now = new Date(
        ev.timestamp ? Number(ev.timestamp) * 1000 : Date.now(),
      );
      switch (ev.event) {
        case 'delivered':
          update.status = 'delivered';
          update.deliveredAt = now;
          break;
        case 'open':
          update.status = 'read';
          update.readAt = now;
          break;
        case 'bounce':
        case 'dropped':
          update.status = 'bounced';
          update.errorMessage = `sendgrid:${ev.event}:${ev.reason ?? 'no_reason'}`;
          break;
        case 'spamreport':
          update.outcome = 'opt_out';
          break;
        default:
          // 'click' / 'deferred' / 'processed' don't change our state
          // model — recorded but not persisted to keep status meaningful.
          continue;
      }

      try {
        await CampaignExecution.updateOne(
          { externalMessageId: { $regex: `^${base}` } },
          { $set: update },
        );
      } catch (err) {
        console.error('sendgrid webhook updateOne failed:', err);
      }
    }
    res.status(200).json({ ok: true, received: events.length });
  } catch (err: any) {
    console.error('sendgrid webhook error:', err);
    res.status(500).json({ error: err?.message ?? 'server_error' });
  }
});

// --- CRUD for Admin Panel ---
// SECURITY FIX: All CRUD routes require authentication
router.use(authenticateToken);

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
      // Get company name from configuration
      const companyInfo = await configurationManager.getCompanyInfo();
      const companyName = companyInfo.name || 'Bot';

      const data = {
        event: 'test.ping',
        timestamp: new Date().toISOString(),
        payload: testPayload,
      };

      const headers: any = {
        'Content-Type': 'application/json',
        'User-Agent': `${companyName}-Bot/1.0`,
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
