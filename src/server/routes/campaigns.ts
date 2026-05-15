import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { campaignService } from '../../services/CampaignService';

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
    const result = await campaignService.launch({
      tenantId,
      campaignId: req.params.id,
      runNow: true,
    });
    res.json(result);
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

router.post(
  '/:id/generate-variants',
  async (_req: Request<{ id: string }>, res: Response) => {
    // Phase 2: invoke CampaignGeneratorAgent via orchestrator
    res
      .status(501)
      .json({ error: 'not_implemented', detail: 'Phase 2 wires this up' });
  },
);

export default router;
