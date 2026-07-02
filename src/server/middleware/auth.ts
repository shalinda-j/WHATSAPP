import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ACTUAL_JWT_SECRET } from '../jwt-secret';

export interface JwtPayload {
  id: string;
  username: string;
  role?: string;
  // Optional tenant binding carried in the signed token. Absent for legacy /
  // super-admin tokens (those admins may switch tenants via X-Tenant-Slug).
  tenantId?: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * Canonical super-admin role + a tolerant matcher.
 *
 * Historically the super-admin identity was written one way and read two
 * others: the bootstrap admin was created as 'superadmin', the tenant-route
 * gate checked 'super-admin', and the tenant resolver checked 'super_admin'.
 * None matched, so the super-admin was locked out of /api/tenants with a 403.
 * New admins are created with SUPER_ADMIN_ROLE; isSuperAdminRole() accepts
 * every legacy spelling so admins already stored in the database keep working
 * without a migration.
 */
export const SUPER_ADMIN_ROLE = 'super_admin';
const SUPER_ADMIN_ALIASES = new Set([
  'super_admin',
  'super-admin',
  'superadmin',
]);
export function isSuperAdminRole(role?: string | null): boolean {
  return typeof role === 'string' && SUPER_ADMIN_ALIASES.has(role);
}

/**
 * Gate for super-admin-only operations (global AI-provider CRUD, tenant
 * management, etc.). Mirrors resolveTenant's definition exactly: a super-admin
 * is a user WITHOUT a tenantId binding in their token (legacy single-admin /
 * default deployments) OR one whose role is explicitly super_admin. Any token
 * that carries a tenantId binding is tenant-scoped and rejected here.
 *
 * Must run AFTER authenticateToken so req.user is populated.
 */
export function requireSuperAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const role = req.user?.role;
  const tenantId = (req.user as { tenantId?: unknown } | undefined)?.tenantId;
  const isSuperAdmin = isSuperAdminRole(role) || !tenantId;
  if (!isSuperAdmin) {
    res.status(403).json({ error: 'super_admin_required' });
    return;
  }
  next();
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('Authentication failed: No token provided for', req.path);
    res.status(401).json({ error: 'No authentication token provided' });
    return;
  }

  jwt.verify(token, ACTUAL_JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT Verification Error:', {
        message: err.message,
        name: err.name,
        expiredAt:
          err instanceof jwt.TokenExpiredError ? err.expiredAt : undefined,
        path: req.path,
      });
      res.status(403).json({
        error: 'Invalid or expired token',
        expired: err.name === 'TokenExpiredError',
      });
      return;
    }
    req.user = user as JwtPayload;
    next();
  });
};
