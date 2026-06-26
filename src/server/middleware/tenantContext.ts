import { Request, Response, NextFunction } from 'express';
import Tenant, { ITenant } from '../../models/Tenant';
import { clientIpFromRequest, isIpAllowed } from '../../services/ipAllowlist';
import { AuthRequest, isSuperAdminRole } from './auth';

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: ITenant;
  }
}

/**
 * Returns a MongoDB query clause that scopes results to the current tenant
 * while ALSO matching legacy rows that pre-date the tenantId migration
 * (rows where tenantId is missing or null). The fall-through keeps existing
 * deployments working without forcing the operator to run the backfill
 * script the same day this code ships.
 *
 * Usage:
 *   const filter = { isActive: true };
 *   const final = withTenantScope(req, filter);
 *   await Dataset.find(final).sort({...});
 *
 * When the tenant resolver hasn't run (or the route is public) the helper
 * returns the input filter untouched — never silently drops scope without
 * the caller noticing.
 */
export function withTenantScope(
  req: Request,
  baseFilter: Record<string, unknown>,
): Record<string, unknown> {
  const tenantId = (req as Request & { tenant?: ITenant }).tenant?._id;
  if (!tenantId) return baseFilter;
  const tenantClause = {
    $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: null }],
  };
  // If baseFilter is empty just return the tenant clause.
  if (Object.keys(baseFilter).length === 0) return tenantClause;
  return { $and: [baseFilter, tenantClause] };
}

/**
 * Resolve the active tenantId from req, or undefined when none.
 * Convenience wrapper that route handlers use when STAMPING tenantId on
 * a newly-created document.
 */
export function tenantIdOf(req: Request): unknown | undefined {
  return (req as Request & { tenant?: ITenant }).tenant?._id;
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
    const userTenantId = (req as any).user?.tenantId as string | undefined;
    const userRole = (req as any).user?.role as string | undefined;

    // A super-admin is any authenticated user WITHOUT a tenant binding in
    // their token (legacy single-admin / default deployments), or one whose
    // role is explicitly 'super_admin'. Super-admins may switch tenants via
    // the X-Tenant-Slug header (a convenience switch). Non-super-admins are
    // locked to their own tenant — the header becomes an AUTHORIZED switch,
    // never an unauthenticated selector.
    const isSuperAdmin = !userTenantId || isSuperAdminRole(userRole);

    let tenant: ITenant | null = null;
    if (isSuperAdmin) {
      // Honor the header as before for super-admins; otherwise default.
      if (headerSlug) {
        tenant = await Tenant.findOne({ slug: headerSlug });
      }
    } else {
      // Non-super-admin: resolve to their OWN tenant from the JWT.
      const ownTenant = await Tenant.findById(userTenantId);

      if (headerSlug) {
        // If the request explicitly asks for a slug, only allow it when it
        // resolves to the user's own tenant. A header pointing at a DIFFERENT
        // tenant is a privilege-escalation attempt → 403.
        const requested = await Tenant.findOne({ slug: headerSlug });
        if (
          requested &&
          ownTenant &&
          String(requested._id) !== String(ownTenant._id)
        ) {
          _res.status(403).json({ error: 'tenant_forbidden' });
          return;
        }
      }

      // Force the user's own tenant regardless of any header value.
      tenant = ownTenant;
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

    // Per-tenant IP allowlist. Skipped when the tenant has no entries
    // configured — single-tenant deployments keep working untouched.
    const allowlist = (tenant as any).ipAllowlist as string[] | undefined;
    if (allowlist && allowlist.length > 0) {
      const ip = clientIpFromRequest(req);
      if (!isIpAllowed(ip, allowlist)) {
        console.warn(
          `🚫 resolveTenant: blocked ${req.method} ${req.path} from ${ip} (tenant=${tenant.slug})`,
        );
        _res.status(403).json({
          error: 'ip_not_allowed',
          message: "Your IP is not on this tenant's allowlist.",
        });
        return;
      }
    }

    // Per-tenant idle session timeout enforced against the JWT issuance
    // timestamp. Skipped when authenticateToken hasn't populated req.user
    // (resolveTenant is occasionally used on public endpoints).
    const timeoutMinutes = (tenant as any).sessionTimeoutMinutes as
      | number
      | undefined;
    const authReq = req as AuthRequest & { user?: { iat?: number } };
    if (timeoutMinutes && timeoutMinutes > 0 && authReq.user?.iat) {
      const issuedAt = Number(authReq.user.iat) * 1000;
      const ageMs = Date.now() - issuedAt;
      if (ageMs > timeoutMinutes * 60 * 1000) {
        _res.status(401).json({
          error: 'session_timeout',
          message: `Session exceeded the tenant idle timeout of ${timeoutMinutes} minute(s). Please log in again.`,
        });
        return;
      }
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    // Previously this silently fell through to next() with req.tenant
    // undefined, which downstream routes interpret as "no tenant scope"
    // and then leak cross-tenant data. Surface the failure so the global
    // error middleware returns a clean 503 with diagnostics, rather than
    // pretending everything is fine.
    console.error('tenantContext middleware failed:', err);
    next(err);
  }
}
