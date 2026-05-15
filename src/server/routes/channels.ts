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
});

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
    config: c.config,
  }));
  res.json(safe);
});

router.post('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant?._id;
  const parsed = ConnectionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  // Phase 4: encrypt every credential value before persisting via CryptoService.
  // const encrypted = mapValues(parsed.data.credentials, cryptoService.encrypt)
  const conn = await ChannelConnection.create({
    tenantId,
    ...parsed.data,
    status: 'pending',
  });

  // Kick the adapter for this tenant so the new credentials take effect
  // without a server restart. Fire-and-forget — the adapter records its
  // own status/error onto the ChannelConnection row.
  const adapter = channelRouter.get(parsed.data.channel);
  if (adapter) {
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

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const tenantId = req.tenant?._id;
  await ChannelConnection.deleteOne({ _id: req.params.id, tenantId });
  res.status(204).end();
});

export default router;
