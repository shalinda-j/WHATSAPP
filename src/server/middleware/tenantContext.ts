import { Request, Response, NextFunction } from 'express';
import Tenant, { ITenant } from '../../models/Tenant';

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: ITenant;
  }
}

/**
 * Resolves the active tenant for an authenticated request.
 *
 * Resolution order:
 *   1. X-Tenant-Slug header (admin/staff switching between tenants)
 *   2. req.user.tenantId (set by authenticateToken once JWT carries tenantId)
 *   3. Default tenant — single-tenant deployments use slug='default'
 *
 * Phase 1 fallback: if no Tenant rows exist yet, every request gets the
 * auto-created default tenant. The data migration job (scripts/migrate-
 * tenant.ts) backfills tenantId on existing records.
 */
export async function resolveTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const headerSlug = (req.headers['x-tenant-slug'] as string) || '';
    const userTenantId = (req as any).user?.tenantId;

    let tenant: ITenant | null = null;
    if (headerSlug) {
      tenant = await Tenant.findOne({ slug: headerSlug });
    } else if (userTenantId) {
      tenant = await Tenant.findById(userTenantId);
    }

    if (!tenant) {
      tenant = await Tenant.findOne({ slug: 'default' });
    }

    if (!tenant) {
      tenant = await Tenant.create({
        slug: 'default',
        name: 'Default Tenant',
        plan: 'free',
        status: 'active',
      });
    }

    if (tenant.status === 'suspended') {
      _res
        .status(403)
        .json({ error: 'Tenant suspended', tenantSlug: tenant.slug });
      return;
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    console.error('tenantContext middleware failed:', err);
    next();
  }
}
