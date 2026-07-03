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

    // Secret Validation.
    // In production WEBHOOK_SECRET is MANDATORY — an unauthenticated inbound
    // webhook can trigger outbound WhatsApp sends, so a missing secret is a
    // hard misconfiguration we refuse to serve. In development we keep the
    // legacy behaviour (skip validation) but warn loudly so the gap is visible.
    if (!process.env.WEBHOOK_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        console.error(
          '❌ WEBHOOK_SECRET is not set — refusing inbound webhook in production. Set WEBHOOK_SECRET to enable this endpoint.',
        );
        return res.status(503).json({
          error: 'Service Unavailable',
          message:
            'Inbound webhook is not configured (missing WEBHOOK_SECRET).',
        });
      }
      console.warn(
        '⚠️ WEBHOOK_SECRET is not set — inbound webhook secret validation is DISABLED (development only).',
      );
    }

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
      string | undefined;
    if (expectedSecret) {
      const got = req.headers['x-telegram-bot-api-secret-token'] as
        string | undefined;
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
// Note: verification is computed over req.rawBody — the exact bytes captured
// by express.json's verify callback in src/server/app.ts — so the HMAC is
// byte-equivalent to what Meta signed. It falls back to JSON.stringify(req.body)
// only if rawBody is unavailable (e.g. a non-JSON parser handled the request).
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
    const ChannelConnection = (await import('../../models/ChannelConnection'))
      .default;
    // NOTE: do NOT use .lean() here — the `credentials` field is stored
    // encrypted and only the Mongoose getter (decryptCredentials) returns the
    // plaintext appSecret. A lean() query returns the raw ciphertext, which
    // would make every HMAC comparison fail. Reading from a hydrated document
    // fires the getter so conn.credentials.appSecret is the real secret.
    const conn = await ChannelConnection.findOne({
      tenantId: tenant._id,
      channel,
    });
    const appSecret = (conn?.credentials as any)?.appSecret as
      string | undefined;
    // In production an unsigned Meta webhook is unverifiable — any attacker who
    // knows the URL could inject fake messages. Refuse rather than silently
    // skip the HMAC check. In development we still allow it so local testing
    // works without an app secret configured.
    if (process.env.NODE_ENV === 'production' && !appSecret) {
      console.error(
        `[${channel}] Meta webhook signature not configured (no appSecret stored) — refusing in production.`,
      );
      return res
        .status(503)
        .json({ error: 'meta_webhook_signature_not_configured' });
    }
    if (appSecret) {
      const sigHeader = req.headers['x-hub-signature-256'] as
        string | undefined;
      if (!sigHeader) {
        console.warn(`[${channel}] Missing X-Hub-Signature-256 from Meta`);
        return res.status(401).json({ error: 'missing_signature' });
      }
      // Prefer the exact received bytes captured by express.json's verify
      // callback (req.rawBody, see src/server/app.ts). HMAC over the raw
      // buffer is byte-equivalent to what Meta signed; falling back to
      // JSON.stringify(req.body) only when rawBody is unavailable.
      const rawBody = (req as any).rawBody as Buffer | undefined;
      const hmacInput: Buffer | string =
        rawBody instanceof Buffer
          ? rawBody
          : typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body);
      const expected =
        'sha256=' +
        crypto.createHmac('sha256', appSecret).update(hmacInput).digest('hex');
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
    // ── SendGrid Event Webhook signature verification ─────────────────────
    // SendGrid signs each POST with an ECDSA signature (the "Signed Event
    // Webhook" feature). The signature header is the base64 ECDSA signature
    // of `timestamp + rawBody`, verifiable against the operator's configured
    // public key (process.env.SENDGRID_WEBHOOK_PUBLIC_KEY, base64 DER/PEM).
    // Without this, anyone who knows the URL can forge delivery/bounce events
    // and corrupt campaign stats. Mirrors the Meta block: refuse in production
    // when unconfigured, warn-and-allow in development.
    const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    if (process.env.NODE_ENV === 'production' && !publicKey) {
      console.error(
        '[sendgrid] Event Webhook signature not configured (no SENDGRID_WEBHOOK_PUBLIC_KEY) — refusing in production.',
      );
      return res
        .status(503)
        .json({ error: 'sendgrid_webhook_signature_not_configured' });
    }
    if (publicKey) {
      const signature = req.headers[
        'x-twilio-email-event-webhook-signature'
      ] as string | undefined;
      const timestamp = req.headers[
        'x-twilio-email-event-webhook-timestamp'
      ] as string | undefined;
      if (!signature || !timestamp) {
        console.warn(
          '[sendgrid] Missing signature/timestamp headers — rejecting',
        );
        return res.status(401).json({ error: 'missing_signature' });
      }
      // Verify over the exact received bytes captured by express.json's verify
      // callback (req.rawBody, see src/server/app.ts). SendGrid signs
      // `timestamp + rawBody`; falling back to JSON.stringify(req.body) only
      // when rawBody is unavailable.
      const rawBody = (req as any).rawBody as Buffer | undefined;
      const bodyStr =
        rawBody instanceof Buffer
          ? rawBody.toString('utf8')
          : typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body);
      let verified = false;
      try {
        // Public key may be supplied as raw base64 DER (SendGrid console) or
        // as a full PEM block. Wrap raw base64 into a SPKI PEM if needed.
        const keyPem = publicKey.includes('BEGIN')
          ? publicKey
          : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
        const verifier = crypto.createVerify('sha256');
        verifier.update(timestamp + bodyStr);
        verifier.end();
        verified = verifier.verify(keyPem, Buffer.from(signature, 'base64'));
      } catch (err) {
        console.warn('[sendgrid] Signature verification threw:', err);
        verified = false;
      }
      if (!verified) {
        console.warn('[sendgrid] Invalid Event Webhook signature — rejecting');
        return res.status(403).json({ error: 'invalid_signature' });
      }
    } else {
      console.warn(
        '[sendgrid] SENDGRID_WEBHOOK_PUBLIC_KEY not set — signature verification DISABLED (development only).',
      );
    }
    // ── end signature verification ────────────────────────────────────────

    const events = Array.isArray(req.body) ? req.body : [];
    const CampaignExecution = (await import('../../models/CampaignExecution'))
      .default;
    const MarketingCampaign = (await import('../../models/MarketingCampaign'))
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
      // Which MarketingCampaign.stats.* counter (if any) a first-time
      // transition into this status should increment.
      let statsField: 'delivered' | 'read' | 'bounced' | undefined;
      // The status value this event transitions the execution into, used to
      // detect a REAL transition (only $inc the campaign stat when the prior
      // status differed, so a repeat SendGrid event never double-counts).
      let newStatus: string | undefined;
      switch (ev.event) {
        case 'delivered':
          update.status = 'delivered';
          update.deliveredAt = now;
          newStatus = 'delivered';
          statsField = 'delivered';
          break;
        case 'open':
          update.status = 'read';
          update.readAt = now;
          newStatus = 'read';
          statsField = 'read';
          break;
        case 'bounce':
        case 'dropped':
          update.status = 'bounced';
          update.errorMessage = `sendgrid:${ev.event}:${ev.reason ?? 'no_reason'}`;
          newStatus = 'bounced';
          statsField = 'bounced';
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
        // findOneAndUpdate with {new:false} returns the PRE-update document so
        // we can compare its prior status against the new one. Only a genuine
        // first-time transition into delivered/read/bounced bumps the campaign
        // aggregate — repeat events (SendGrid retries, duplicate batches) hit
        // the same status and are skipped, preventing double-counting.
        const prev = await CampaignExecution.findOneAndUpdate(
          { externalMessageId: { $regex: `^${base}` } },
          { $set: update },
          { new: false },
        );
        if (
          prev &&
          statsField &&
          newStatus &&
          prev.status !== newStatus &&
          prev.campaignId
        ) {
          try {
            await MarketingCampaign.updateOne(
              { _id: prev.campaignId, tenantId: prev.tenantId },
              { $inc: { [`stats.${statsField}`]: 1 } },
            );
          } catch (statErr) {
            console.error('sendgrid webhook stats $inc failed:', statErr);
          }
        }
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

// --- WHATSAPP BUSINESS CALLING API ---
// Live voice call answering. Meta delivers call lifecycle events (ringing /
// connect / terminate) to a Cloud API webhook, carrying the caller's WebRTC
// offer SDP. We hand each event to WhatsAppCallingService, which negotiates a
// media bridge and routes through LiveCallService → BusinessCallingApiProvider
// to accept the call and stream TTS audio. Falls back to reject if the media
// stack / credentials are unavailable.
//
// GET  = Meta verification handshake (hub.challenge).
// POST = call events. Signature verified via X-Hub-Signature-256 when an
//        app secret is configured (env WHATSAPP_APP_SECRET or per-tenant).

router.get('/whatsapp-calling', metaEventRateLimit, async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const { liveCallSettings } =
    await import('../../services/LiveCallSettingsService');
  const expected = await liveCallSettings.getWebhookVerifyToken();
  if (mode === 'subscribe' && expected && token === expected) {
    return res.status(200).send(String(challenge ?? ''));
  }
  return res.status(403).send('forbidden');
});

router.post('/whatsapp-calling', metaEventRateLimit, async (req, res) => {
  try {
    // Optional HMAC verification: Meta signs the body with the app secret.
    const { liveCallSettings } =
      await import('../../services/LiveCallSettingsService');
    const appSecret = await liveCallSettings.getAppSecret();
    if (appSecret) {
      const sigHeader = req.headers['x-hub-signature-256'] as
        string | undefined;
      const bodyStr =
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const expected =
        'sha256=' +
        crypto.createHmac('sha256', appSecret).update(bodyStr).digest('hex');
      let ok = false;
      if (sigHeader) {
        try {
          const a = Buffer.from(sigHeader);
          const b = Buffer.from(expected);
          ok = a.length === b.length && crypto.timingSafeEqual(a, b);
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        console.warn('[whatsapp-calling] Invalid X-Hub-Signature-256');
        return res.status(403).json({ error: 'invalid_signature' });
      }
    }

    // Always 200 fast so Meta doesn't retry; process calls asynchronously.
    res.status(200).json({ ok: true });

    const { WhatsAppCallingService } =
      await import('../../services/whatsappCalling/WhatsAppCallingService');

    // Cloud API shape: entry[].changes[].value.calls[]
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const calls = Array.isArray(value.calls) ? value.calls : [];
        const phoneNumberId =
          value?.metadata?.phone_number_id ||
          process.env.WHATSAPP_PHONE_NUMBER_ID ||
          'whatsapp-calling';
        for (const call of calls) {
          await WhatsAppCallingService.handleWebhookCall(
            call,
            String(phoneNumberId),
          ).catch((err) =>
            console.error('whatsapp-calling handleWebhookCall error:', err),
          );
        }
      }
    }
  } catch (err: any) {
    console.error('whatsapp-calling webhook error:', err);
    // Response already sent (200) in the happy path; guard double-send.
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message ?? 'server_error' });
    }
  }
});

// --- CRUD for Admin Panel ---
// SECURITY FIX: All CRUD routes require authentication + tenant scope.
router.use(authenticateToken);
router.use(resolveTenant);

/**
 * Strip the HMAC signing secret from a webhook before returning it to a client,
 * replacing it with a `hasSecret` boolean. The secret is encrypted at rest, but
 * it must never leave the server in ANY form (the previous handlers returned it
 * verbatim to every authed caller).
 */
function redactWebhook(doc: unknown): Record<string, unknown> {
  const o = (
    doc && typeof (doc as any).toObject === 'function'
      ? (doc as any).toObject()
      : { ...(doc as any) }
  ) as Record<string, unknown>;
  const hasSecret = typeof o.secret === 'string' && o.secret.trim() !== '';
  delete o.secret;
  o.hasSecret = hasSecret;
  return o;
}

// Get all webhooks (tenant-scoped)
router.get('/', async (req, res) => {
  try {
    const webhooks = await (Webhook as any)
      .find(withTenantScope(req, {}))
      .sort({ createdAt: -1 });
    res.json((webhooks as unknown[]).map(redactWebhook));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new webhook (stamped with the current tenant)
router.post('/', async (req, res) => {
  try {
    const tid = tenantIdOf(req);
    const webhook = new (Webhook as any)({
      ...req.body,
      ...(tid ? { tenantId: tid } : {}),
    });
    await webhook.save();
    res.status(201).json(redactWebhook(webhook));
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Update webhook (tenant-scoped: a tenant can only update its own webhooks)
router.put('/:id', async (req, res) => {
  try {
    // Never overwrite a stored secret with an empty/blank value (edit forms
    // come back with the secret redacted, so an omitted/blank secret must
    // PRESERVE the existing one rather than wipe it).
    const body = { ...req.body };
    if (
      Object.prototype.hasOwnProperty.call(body, 'secret') &&
      (typeof body.secret !== 'string' || body.secret.trim() === '')
    ) {
      delete body.secret;
    }
    const webhook = await (Webhook as any).findOneAndUpdate(
      withTenantScope(req, { _id: req.params.id }),
      body,
      { new: true },
    );
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    res.json(redactWebhook(webhook));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete webhook (tenant-scoped)
router.delete('/:id', async (req, res) => {
  try {
    const webhook = await (Webhook as any).findOneAndDelete(
      withTenantScope(req, { _id: req.params.id }),
    );
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ message: 'Webhook deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Test webhook (tenant-scoped: can only test your own tenant's webhooks)
router.post('/:id/test', async (req, res) => {
  try {
    const webhook = await (Webhook as any).findOne(
      withTenantScope(req, { _id: req.params.id }),
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
