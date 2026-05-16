import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import Tenant from '../../models/Tenant';

const router = Router();
router.use(authenticateToken);

/**
 * Tenant management is a super-admin / admin operation. Without this gate
 * any authenticated user could enumerate every tenant in the deployment
 * — a serious info-disclosure leak for multi-tenant installs.
 */
function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'super-admin') {
    return res.status(403).json({ error: 'admin_role_required' });
  }
  next();
}
router.use(requireAdmin);

const TenantCreateSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  plan: z.enum(['free', 'starter', 'growth', 'enterprise']).default('free'),
  brand: z
    .object({
      industry: z.string().optional(),
      voice: z.string().optional(),
      primaryLanguage: z.string().default('si'),
      timezone: z.string().default('Asia/Colombo'),
      websiteUrl: z.string().url().optional(),
    })
    .optional(),
});

router.get('/', async (_req: Request, res: Response) => {
  // Phase 4: gate this behind a super-admin role check
  const items = await Tenant.find().sort({ createdAt: -1 });
  res.json(items);
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = TenantCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const existing = await Tenant.findOne({ slug: parsed.data.slug });
  if (existing) {
    return res.status(409).json({ error: 'slug_taken' });
  }
  const tenant = await Tenant.create(parsed.data);
  res.status(201).json(tenant);
});

router.patch(
  '/:slug',
  async (req: Request<{ slug: string }>, res: Response) => {
    const updated = await Tenant.findOneAndUpdate(
      { slug: req.params.slug },
      { $set: req.body },
      { new: true },
    );
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json(updated);
  },
);

router.post(
  '/:slug/suspend',
  async (req: Request<{ slug: string }>, res: Response) => {
    await Tenant.updateOne(
      { slug: req.params.slug },
      { $set: { status: 'suspended' } },
    );
    res.status(204).end();
  },
);

router.post(
  '/:slug/activate',
  async (req: Request<{ slug: string }>, res: Response) => {
    await Tenant.updateOne(
      { slug: req.params.slug },
      { $set: { status: 'active' } },
    );
    res.status(204).end();
  },
);

export default router;
