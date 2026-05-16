import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { asyncHandler } from '../middleware/asyncHandler';
import { marketingInsightsService } from '../../services/MarketingInsightsService';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

router.get(
  '/report',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = String(req.tenant?._id);
    const windowDays = parseInt((req.query.windowDays as string) ?? '30', 10);
    const report = await marketingInsightsService.buildReport(
      tenantId,
      windowDays,
    );
    res.json(report);
  }),
);

router.get(
  '/channels',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = String(req.tenant?._id);
    const windowDays = parseInt((req.query.windowDays as string) ?? '30', 10);
    const perChannel = await marketingInsightsService.perChannelPerformance(
      tenantId,
      windowDays,
    );
    res.json(perChannel);
  }),
);

export default router;
