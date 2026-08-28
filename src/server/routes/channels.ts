import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import ChannelConnection from '../../models/ChannelConnection';
import { ChannelSchema } from '../../types/agent';
import { channelRouter } from '../../channels';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

const ConnectionCreateSchema = z.object({
  channel: ChannelSchema,
  label: z.string().min(1).max(80),
  credentials: z.record(z.string(), z.string()).default({}),
  config: z.record(z.string(), z.unknown()).default({}),
  agentBindings: z.array(z.string()).default([]),
});

const BindingsUpdateSchema = z.object({
  agentBindings: z.array(z.string()),
});

/**
 * Config blobs can accumulate sensitive values (tokens, secrets, keys) — e.g.
 * OAuth callbacks persist accessToken/refreshToken onto config in some shapes.
 * Strip any key matching a known-sensitive name before returning config to the
 * client. Non-sensitive fields are preserved intact.
 */
const SENSITIVE_CONFIG_KEYS = new Set([
  'webhooksecret',
  'verifytoken',
  'appsecret',
  'apikey',
  'token',
  'accesstoken',
  'secret',
  'password',
  'clientsecret',
  'privatekey',
]);

function stripSecrets(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!config || typeof config !== 'object') return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_CONFIG_KEYS.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  return safe;
}

router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant?._id;
  const items = await ChannelConnection.find({ tenantId }).sort({
    channel: 1,
    label: 1,
  });
  // Strip raw credentials from response — operator UI sees only "configured".
  const safe = items.map((c) => ({
    _id: c._id,
    channel: c.channel,
    label: c.label,
    status: c.status,
    lastError: c.lastError,
    lastConnectedAt: c.lastConnectedAt,
    hasCredentials: Object.keys(c.credentials ?? {}).length > 0,
    config: stripSecrets(c.config as Record<string, unknown> | undefined),
    agentBindings: c.agentBindings ?? [],
  }));
  res.json(safe);
});

router.post('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant?._id;
  const parsed = ConnectionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  // Credentials are encrypted at rest by the ChannelConnection model's
  // setter (CryptoService), so they're stored as ciphertext and decrypted
  // transparently when adapters read them — no plaintext secrets in Mongo.
  const conn = await ChannelConnection.create({
    tenantId,
    ...parsed.data,
    status: 'pending',
  });

  // Kick the adapter for this tenant so the new credentials take effect
  // without a server restart. Tear down any existing session first so the
  // adapter rebuilds from the latest ChannelConnection instead of reusing
  // stale creds. Fire-and-forget — the adapter records its own status/error
  // onto the ChannelConnection row.
  const adapter = channelRouter.get(parsed.data.channel);
  if (adapter) {
    await adapter.stop(String(tenantId)).catch(() => {
      /* best-effort stop before restart; ignore if not running */
    });
    adapter.start(String(tenantId)).catch((err) => {
      console.error(`adapter.start for ${parsed.data.channel} failed:`, err);
    });
  }

  res.status(201).json({ _id: conn._id });
});

router.post(
  '/:id/test',
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = req.tenant?._id;
    const conn = await ChannelConnection.findOne({
      _id: req.params.id,
      tenantId,
    });
    if (!conn) return res.status(404).json({ error: 'not_found' });
    const adapter = channelRouter.get(conn.channel);
    if (!adapter) {
      return res
        .status(400)
        .json({ error: 'no_adapter', channel: conn.channel });
    }
    const status = await adapter.status(String(tenantId));
    res.json({ adapter: conn.channel, ...status });
  },
);

router.patch(
  '/:id/bindings',
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = req.tenant?._id;
    const parsed = BindingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const conn = await ChannelConnection.findOneAndUpdate(
      { _id: req.params.id, tenantId },
      { agentBindings: parsed.data.agentBindings },
      { returnDocument: 'after' },
    );
    if (!conn) return res.status(404).json({ error: 'not_found' });
    res.json({
      _id: conn._id,
      agentBindings: conn.agentBindings ?? [],
    });
  },
);

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const tenantId = req.tenant?._id;
  await ChannelConnection.deleteOne({ _id: req.params.id, tenantId });
  res.status(204).end();
});

export default router;
