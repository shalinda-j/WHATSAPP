/**
 * Content generation endpoints. Provider-agnostic — the ImageGenService picks
 * the right adapter based on which API keys are configured.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import GeneratedAsset from '../../models/GeneratedAsset';
import { imageGenService } from '../../services/contentGen/ImageGenService';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

const ImageGenSchema = z.object({
  prompt: z.string().min(3).max(4000),
  negativePrompt: z.string().max(2000).optional(),
  size: z.string().max(40).optional(),
  provider: z.string().max(40).optional(),
  model: z.string().max(80).optional(),
  attachedTo: z
    .object({
      kind: z.enum(['campaign', 'agent', 'manual']),
      refId: z.string().optional(),
    })
    .optional(),
});

router.get('/providers', (_req: Request, res: Response) => {
  res.json({ providers: imageGenService.list() });
});

router.get('/assets', async (req: Request, res: Response) => {
  const tenantId = req.tenant?._id;
  const { type, limit = 50 } = req.query;
  const filter: Record<string, unknown> = { tenantId };
  if (typeof type === 'string') filter.type = type;
  const assets = await GeneratedAsset.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();
  res.json({ assets });
});

router.post('/image/generate', async (req: Request, res: Response) => {
  const tenantId = req.tenant?._id;
  if (!tenantId) return res.status(401).json({ error: 'no_tenant' });

  const parsed = ImageGenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  // Insert a pending row up-front so the UI sees the request in the gallery
  // immediately and so a partial provider failure still leaves a trace.
  const asset = await GeneratedAsset.create({
    tenantId,
    type: 'image',
    provider: parsed.data.provider ?? 'auto',
    modelName: parsed.data.model,
    prompt: parsed.data.prompt,
    negativePrompt: parsed.data.negativePrompt,
    size: parsed.data.size,
    status: 'pending',
    attachedTo: parsed.data.attachedTo,
  });

  try {
    const { provider, result } = await imageGenService.generate(parsed.data);
    asset.provider = provider;
    asset.url = result.url;
    asset.inlineBase64 = result.inlineBase64;
    asset.costUsd = result.costUsd;
    asset.meta = result.meta;
    asset.status = 'ready';
    await asset.save();
    return res.json({ asset });
  } catch (err: unknown) {
    asset.status = 'failed';
    asset.errorMessage =
      err instanceof Error ? err.message : 'unknown image-gen error';
    await asset.save();
    const ready = imageGenService.list().some((p) => p.ready);
    return res.status(ready ? 502 : 503).json({
      error: asset.errorMessage,
      asset,
      providers: imageGenService.list(),
    });
  }
});

router.delete('/assets/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant?._id;
  await GeneratedAsset.deleteOne({ _id: req.params.id, tenantId });
  res.status(204).end();
});

export default router;
