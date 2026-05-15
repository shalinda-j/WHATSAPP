import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { segmentationService } from '../../services/SegmentationService';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

router.get('/', async (req: Request, res: Response) => {
  const tenantId = String(req.tenant?._id);
  const items = await segmentationService.list(tenantId);
  res.json(items);
});

router.post('/', async (req: Request, res: Response) => {
  const tenantId = String(req.tenant?._id);
  const created = await segmentationService.create(tenantId, req.body);
  res.status(201).json(created);
});

router.patch(
  '/:id',
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = String(req.tenant?._id);
    const updated = await segmentationService.update(
      tenantId,
      req.params.id,
      req.body,
    );
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json(updated);
  },
);

router.post(
  '/:id/recompute',
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = String(req.tenant?._id);
    const count = await segmentationService.recompute(tenantId, req.params.id);
    res.json({ memberCount: count });
  },
);

router.post('/from-description', async (_req: Request, res: Response) => {
  // Phase 2: invoke SegmentationAgent via orchestrator
  res
    .status(501)
    .json({ error: 'not_implemented', detail: 'Phase 2 wires this up' });
});

export default router;
