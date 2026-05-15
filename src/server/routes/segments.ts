import { Router, Request, Response } from 'express';
import { z } from 'zod';
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

router.patch('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const tenantId = String(req.tenant?._id);
  const updated = await segmentationService.update(
    tenantId,
    req.params.id,
    req.body,
  );
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json(updated);
});

router.post(
  '/:id/recompute',
  async (req: Request<{ id: string }>, res: Response) => {
    const tenantId = String(req.tenant?._id);
    const count = await segmentationService.recompute(tenantId, req.params.id);
    res.json({ memberCount: count });
  },
);

const DescribeSegmentRequestSchema = z.object({
  description: z.string().min(3).max(2000),
});

router.post('/from-description', async (req: Request, res: Response) => {
  const tenantId = String(req.tenant?._id);
  const parsed = DescribeSegmentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'validation_failed', detail: parsed.error.message });
  }
  try {
    const result = await segmentationService.describeSegment({
      tenantId,
      description: parsed.data.description,
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
