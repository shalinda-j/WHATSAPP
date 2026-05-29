import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import Webhook from '../../models/Webhook';
import { sendMessage, getSocket } from '../../services/whatsapp';
import { WebhookService } from '../../services/WebhookService';
import { configurationManager } from '../../services/ConfigurationManagerService';
import { authenticateToken } from '../middleware/auth';
import {
  resolveTenant,
  withTenantScope,
  tenantIdOf,
} from '../middleware/tenantContext';
import { rateLimit, lenientRateLimit } from '../middleware/rateLimit';

const router = express.Router();

// Public webhook endpoints (Telegram / Meta / SendGrid) need anti-abuse
// rate limiting. Each provider has its own legitimate burst pattern:
//   Telegram: long-poll mode replays updates if our 200 is slow; webhook
//             mode is one event per message. 300/min/IP is generous.
//   Meta: batches up to ~100 events per POST. 60/min/IP is fine.
//   SendGrid: ~once-per-minute event batches. 60/min/IP.
const webhookRateLimit = lenientRateLimit;
const metaEventRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Webhook rate limit exceeded',
});

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
router.post('/telegram/:tenantSlug', webhookRateLimit, async (req, res) => {
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

// Meta Messenger / Instagram webhook handshake: Meta sends a GET request
// with hub.verify_token + hub.challenge during app review setup. We echo
// the challenge back if the verify token matches the value the operator
// stored on the ChannelConnection.config.verifyToken.
async function metaWebhookHandshake(
  req: express.Request,
  res: express.Response,
  channel: 'instagram' | 'facebook',
) {
  try {
    const tenantSlug = req.params.tenantSlug;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode !== 'subscribe') return res.status(400).send('bad_mode');

    const Tenant = (await import('../../models/Tenant')).default;
    const ChannelConnection = (await import('../../models/ChannelConnection'))
      .default;

    const tenant = await Tenant.findOne({ slug: tenantSlug });
    if (!tenant) return res.status(404).send('tenant_not_found');
    const conn = await ChannelConnection.findOne({
      tenantId: tenant._id,
      channel,
    });
    const expected = (conn?.config as any)?.verifyToken as string | undefined;
    if (!expected || token !== expected)
      return res.status(403).send('forbidden');

    return res.status(200).send(String(challenge ?? ''));
  } catch (err: any) {
    console.error(`${channel} webhook handshake error:`, err);
    return res.status(500).send('server_error');
  }
}

// Meta webhook POST receiver: forwards to the adapter's ingestWebhook
// method, which normalises Meta's batch shape into InboundMessage and
// runs them through the channelRouter handlers — same orchestrator
// path Telegram + WhatsApp use.
//
// Security: verifies X-Hub-Signature-256 HMAC when the operator has stored
// an `appSecret` in ChannelConnection.credentials. Meta signs every POST
// body with HMAC-SHA256 using the app secret and sends it in this header.
// Without this check, any attacker who knows the webhook URL can inject
// fake messages. When appSecret is absent, verification is skipped so
// that operators who haven't added the secret yet aren't silently broken.
//
// Note: verification uses JSON.stringify(req.body) which is byte-equivalent
// to the original body only when Express's JSON parser doesn't reformat
// it. For byte-exact verification in production, configure express.raw()
// on this route and store the raw buffer (see rawBody middleware pattern).
async function metaWebhookIngest(
  req: express.Request,
  res: express.Response,
  channel: 'instagram' | 'facebook',
) {
  try {
    const tenantSlug = req.params.tenantSlug;
    const Tenant = (await import('../../models/Tenant')).default;
    const tenant = await Tenant.findOne({ slug: tenantSlug });
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

    // ── X-Hub-Signature-256 verification ──────────────────────────────────
    const ChannelConnection = (
      await import('../../models/ChannelConnection')
    ).default;
    const conn = await ChannelConnection.findOne({
      tenantId: tenant._id,
      channel,
    }).lean();
    const appSecret = (conn?.credentials as any)?.appSecret as
      | string
      | undefined;
    if (appSecret) {
      const sigHeader = req.headers['x-hub-signature-256'] as string | undefined;
      if (!sigHeader) {
        console.warn(`[${channel}] Missing X-Hub-Signature-256 from Meta`);
        return res.status(401).json({ error: 'missing_signature' });
      }
      const bodyStr =
        typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body);
      const expected =
        'sha256=' +
        crypto.createHmac('sha256', appSecret).update(bodyStr).digest('hex');
      // timingSafeEqual prevents timing-based secret extraction attacks
      try {
        const sigBuf = Buffer.from(sigHeader);
        const expBuf = Buffer.from(expected);
        if (
          sigBuf.length !== expBuf.length ||
          !crypto.timingSafeEqual(sigBuf, expBuf)
        ) {
          console.warn(`[${channel}] Invalid X-Hub-Signature-256 — rejecting`);
          return res.status(403).json({ error: 'invalid_signature' });
        }
      } catch {
        return res.status(403).json({ error: 'invalid_signature' });
      }
    }
    // ── end signature verification ─────────────────────────────────────────

    const { channelRouter } = await import('../../channels');
    const adapter = channelRouter.get(channel) as any;
    if (adapter?.ingestWebhook) {
      await adapter.ingestWebhook(String(tenant._id), req.body);
    }
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error(`${channel} webhook ingest error:`, err);
    return res.status(500).json({ error: err?.message ?? 'server_error' });
  }
}

router.get('/instagram/:tenantSlug', metaEventRateLimit, (req, res) =>
  metaWebhookHandshake(req, res, 'instagram'),
);
router.post('/instagram/:tenantSlug', metaEventRateLimit, (req, res) =>
  metaWebhookIngest(req, res, 'instagram'),
);
router.get('/facebook/:tenantSlug', metaEventRateLimit, (req, res) =>
  metaWebhookHandshake(req, res, 'facebook'),
);
router.post('/facebook/:tenantSlug', metaEventRateLimit, (req, res) =>
  metaWebhookIngest(req, res, 'facebook'),
);

// SendGrid event webhook: delivery / bounce / open / click / spam reports
// arrive here in batches. We map externalMessageId → CampaignExecution
// row → update its status so the marketing insights pipeline sees real
// delivery + reply rates instead of just queue → sent counts.
//
// SendGrid sends a JSON array; each event has sg_message_id (matches our
// stored externalMessageId), event ('delivered' / 'bounce' / 'open' /
// 'click' / 'spamreport' / 'dropped' / 'deferred'), and a timestamp.
router.post('/sendgrid', metaEventRateLimit, async (req, res) => {
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
// SECURITY FIX: All CRUD routes require authentication + tenant scope.
router.use(authenticateToken);
router.use(resolveTenant);

// Get all webhooks (tenant-scoped)
router.get('/', async (req, res) => {
  try {
    const webhooks = await (Webhook as any)
      .find(withTenantScope(req, {}))
      .sort({ createdAt: -1 });
    res.json(webhooks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new webhook (stamped with the current tenant)
router.post('/', async (req, res) => {
  try {
    const tid = tenantIdOf(req);

    // Explicitly destructure fields to prevent Mass Assignment
    const { name, url, events, secret, isActive, category, format } = req.body;

    const webhookData: any = {};
    if (name !== undefined) webhookData.name = name;
    if (url !== undefined) webhookData.url = url;
    if (events !== undefined) webhookData.events = events;
    if (secret !== undefined) webhookData.secret = secret;
    if (isActive !== undefined) webhookData.isActive = isActive;
    if (category !== undefined) webhookData.category = category;
    if (format !== undefined) webhookData.format = format;

    const webhook = new (Webhook as any)({
      ...webhookData,
      ...(tid ? { tenantId: tid } : {}),
    });
    await webhook.save();
    res.status(201).json(webhook);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Update webhook
router.put('/:id', async (req, res) => {
  try {
    // Explicitly destructure fields to prevent Mass Assignment
    const { name, url, events, secret, isActive, category, format } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (url !== undefined) updateData.url = url;
    if (events !== undefined) updateData.events = events;
    if (secret !== undefined) updateData.secret = secret;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (category !== undefined) updateData.category = category;
    if (format !== undefined) updateData.format = format;

    // Use withTenantScope to prevent IDOR
    const webhook = await (Webhook as any).findOneAndUpdate(
      withTenantScope(req, { _id: req.params.id }),
      { $set: updateData },
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
    // Use withTenantScope to prevent IDOR
    const webhook = await (Webhook as any).findOneAndDelete(
      withTenantScope(req, { _id: req.params.id })
    );
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ message: 'Webhook deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Test webhook
router.post('/:id/test', async (req, res) => {
  try {
    // Use withTenantScope to prevent IDOR
    const webhook = await (Webhook as any).findOne(
      withTenantScope(req, { _id: req.params.id })
    );
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
