/**
 * Operator-facing read endpoints for the Local NLP Cache. Surfaces the
 * hit-rate metrics added by the multi-language / canonical-index pass so
 * the operator can see exactly which intents are paying for themselves.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { nlpService } from '../../services/NLPService';

const router = Router();
router.use(authenticateToken);

router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await nlpService.getStats();
    res.json(stats);
  }),
);

router.get(
  '/ready',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ ready: nlpService.isReady() });
  }),
);

export default router;
