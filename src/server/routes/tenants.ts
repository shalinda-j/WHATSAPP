import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requireSuperAdmin } from '../middleware/auth';
import Tenant from '../../models/Tenant';

const router = Router();
router.use(authenticateToken);

/**
 * Tenant management (enumerate / rename / replan / suspend / activate ANY
 * tenant) is a SUPER-ADMIN operation — see requireSuperAdmin in
 * middleware/auth.ts. Tenant-bound admins carry a tenantId in their JWT and
 * are rejected, preventing cross-tenant privilege escalation + DoS.
 */
router.use(requireSuperAdmin);

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

/**
 * Explicit allowlist of fields an admin may edit via PATCH. Mirrors the
 * editable surface of the create schema + Tenant model. Spreading req.body
 * straight into $set let a caller overwrite arbitrary fields (slug, budget,
 * ownerAdminId, …) — so we validate and only apply the known subset.
 */
const TenantUpdateSchema = z
  .object({
    name: z.string().min(1).max(120),
    plan: z.enum(['free', 'starter', 'growth', 'enterprise']),
    status: z.enum(['active', 'suspended', 'archived']),
    brand: z.object({
      industry: z.string().optional(),
      voice: z.string().optional(),
      primaryLanguage: z.string().optional(),
      timezone: z.string().optional(),
      websiteUrl: z.string().url().optional(),
    }),
    ipAllowlist: z.array(z.string()),
    sessionTimeoutMinutes: z.number().int().positive(),
  })
  .partial()
  .strict();

router.patch(
  '/:slug',
  async (req: Request<{ slug: string }>, res: Response) => {
    const parsed = TenantUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const updated = await Tenant.findOneAndUpdate(
      { slug: req.params.slug },
      { $set: parsed.data },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json(updated);
  },
);

router.post(
  '/:slug/suspend',
  async (req: Request<{ slug: string }>, res: Response) => {
    const r = await Tenant.updateOne(
      { slug: req.params.slug },
      { $set: { status: 'suspended' } },
    );
    if (r.matchedCount === 0)
      return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  },
);

router.post(
  '/:slug/activate',
  async (req: Request<{ slug: string }>, res: Response) => {
    const r = await Tenant.updateOne(
      { slug: req.params.slug },
      { $set: { status: 'active' } },
    );
    if (r.matchedCount === 0)
      return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  },
);

export default router;
