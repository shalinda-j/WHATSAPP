import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import {
  ResolvedIdentity,
  identityCan,
  resolveIdentity,
} from '../../services/PermissionService';
import { PermissionKey } from '../../config/permissions';

export interface PermissionRequest extends AuthRequest {
  /** Populated by requirePermission / loadIdentity. */
  identity?: ResolvedIdentity;
}

/**
 * Attach the caller's resolved identity to the request without gating on
 * anything. Useful for routes that vary their RESPONSE by permission (e.g.
 * hiding a field) rather than rejecting outright.
 *
 * Must run after authenticateToken.
 */
export async function loadIdentity(
  req: PermissionRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.user?.id) {
      const identity = await resolveIdentity(req.user.id);
      if (identity) req.identity = identity;
    }
  } catch (err) {
    console.error('loadIdentity failed:', err);
  }
  next();
}

/**
 * Gate a route (or a whole router) on one or more permissions. The caller
 * needs EVERY key listed — use requireAnyPermission for an OR.
 *
 * Two failure modes are distinguished on purpose:
 *   401 — the token is fine but the account is gone (deleted mid-session)
 *   403 — the account exists but lacks the permission, or is disabled
 * so the frontend can bounce the first to /login and show a "no access"
 * screen for the second instead of logging the user out.
 *
 * Must run AFTER authenticateToken.
 */
export function requirePermission(...required: PermissionKey[]) {
  return async (
    req: PermissionRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
      }
      const identity = req.identity ?? (await resolveIdentity(req.user.id));
      if (!identity) {
        res.status(401).json({ error: 'account_not_found' });
        return;
      }
      req.identity = identity;

      if (identity.status === 'disabled') {
        res.status(403).json({ error: 'account_disabled' });
        return;
      }

      const missing = required.filter((key) => !identityCan(identity, key));
      if (missing.length > 0) {
        res.status(403).json({
          error: 'permission_denied',
          required: missing,
        });
        return;
      }
      next();
    } catch (err) {
      console.error('requirePermission failed:', err);
      res.status(500).json({ error: 'permission_check_failed' });
    }
  };
}

/** Gate on holding AT LEAST ONE of the listed permissions. */
export function requireAnyPermission(...required: PermissionKey[]) {
  return async (
    req: PermissionRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
      }
      const identity = req.identity ?? (await resolveIdentity(req.user.id));
      if (!identity) {
        res.status(401).json({ error: 'account_not_found' });
        return;
      }
      req.identity = identity;

      if (identity.status === 'disabled') {
        res.status(403).json({ error: 'account_disabled' });
        return;
      }
      if (required.some((key) => identityCan(identity, key))) {
        next();
        return;
      }
      res.status(403).json({ error: 'permission_denied', required });
    } catch (err) {
      console.error('requireAnyPermission failed:', err);
      res.status(500).json({ error: 'permission_check_failed' });
    }
  };
}
