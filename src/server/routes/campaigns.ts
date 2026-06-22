import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { strictRateLimit } from '../middleware/rateLimit';
import { campaignService } from '../../services/CampaignService';
import MarketingCampaign from '../../models/MarketingCampaign';
import { ChannelSchema } from '../../types/agent';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

router.get('/', async (req: Request, res: Response) => {
  const tenantId = String(req.tenant?._id);
  const items = await campaignService.list(tenantId);
  res.json(items);
});

router.post('/', async (req: Request, res: Response) => {
  const tenantId = String(req.tenant?._id);
  const created = await campaignService.create(tenantId, req.body);
  res.status(201).json(created);
});

router.patch('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const tenantId = String(req.tenant?._id);
  const updated = await campaignService.update(
    tenantId,
    req.params.id,
    req.body,
  );
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json(updated);
});

router.post(
  '/:id/launch',
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = String(req.tenant?._id);
    try {
      const result = await campaignService.launch({
        tenantId,
        campaignId: req.params.id,
        runNow: true,
      });
      res.json(result);
    } catch (err) {
      // launch() throws domain errors (no_variants, no_channels,
      // segment_empty, no_routable_channel, campaign_not_found, already_running)
      // — surface them as a clean {error} body so the admin UI can tell the
      // operator why the launch was refused instead of showing a generic 500.
      const msg = err instanceof Error ? err.message : String(err);
      // already_running is a conflict (the campaign is already live), not a bad
      // request — map it to 409 so the UI can show "already running" distinctly.
      const status =
        msg === 'campaign_not_found'
          ? 404
          : msg === 'already_running'
            ? 409
            : 400;
      res.status(status).json({ error: msg });
    }
  },
);

router.post(
  '/:id/pause',
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = String(req.tenant?._id);
    await campaignService.pause(tenantId, req.params.id);
    res.status(204).end();
  },
);

router.post(
  '/:id/resume',
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = String(req.tenant?._id);
    await campaignService.resume(tenantId, req.params.id);
    res.status(204).end();
  },
);

const GenerateVariantsRequestSchema = z.object({
  audienceDescription: z.string().min(3).max(2000),
  goal: z.string().min(3).max(500),
  channels: z.array(ChannelSchema).optional(),
  variantCount: z.number().int().min(1).max(5).optional(),
  languageHint: z.string().max(20).optional(),
});

router.post(
  '/:id/generate-variants',
  // LLM call — strictly rate-limit per-IP so a misconfigured operator
  // doesn't burn the daily token budget by spamming the button.
  strictRateLimit,
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = String(req.tenant?._id);
    const parsed = GenerateVariantsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'validation_failed', detail: parsed.error.message });
    }
    try {
      const result = await campaignService.generateVariants({
        tenantId,
        campaignId: req.params.id,
        ...parsed.data,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg === 'campaign_not_found' ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  },
);

// Delete a campaign (tenant-scoped). Draft/paused/completed campaigns can be
// removed; queued executions are left to drain or can be cleaned separately.
router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const tenantId = String(req.tenant?._id);
  const r = await MarketingCampaign.deleteOne({
    _id: req.params.id,
    tenantId,
  });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

export default router;
