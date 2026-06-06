/**
 * Operator-facing endpoints for the conversion loop (user → customer).
 *  GET  /api/conversions/stats  — totals + breakdown by kind + recent events
 *  GET  /api/conversions        — recent conversion events
 *  POST /api/conversions/fee-paid — manual money-confirmed conversion label
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { conversionService } from '../../services/ConversionService';
import ConversionEvent from '../../models/ConversionEvent';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

router.get('/stats', async (req: Request, res: Response) => {
  const tenantId = req.tenant?._id ? String(req.tenant._id) : undefined;
  res.json(await conversionService.getStats(tenantId));
});

router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant?._id ? String(req.tenant._id) : undefined;
  const query: Record<string, unknown> = {};
  if (tenantId) query.tenantId = tenantId;
  const events = await ConversionEvent.find(query)
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json(events);
});

router.post('/fee-paid', async (req: Request, res: Response) => {
  const { phoneNumber, valueLkr, note } = req.body || {};
  if (!phoneNumber) {
    res.status(400).json({ error: 'phoneNumber is required' });
    return;
  }
  const tenantId = req.tenant?._id ? String(req.tenant._id) : undefined;
  await conversionService.recordConversion({
    phoneNumber: String(phoneNumber),
    kind: 'fee_paid',
    valueLkr: typeof valueLkr === 'number' ? valueLkr : undefined,
    note: typeof note === 'string' ? note : undefined,
    tenantId,
    source: 'manual',
  });
  res.json({ ok: true });
});

export default router;
