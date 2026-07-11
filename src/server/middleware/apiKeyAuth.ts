import { Request, Response, NextFunction } from 'express';
import ApiKey, { hashApiKey, ApiKeyScope } from '../../models/ApiKey';
import Tenant, { ITenant } from '../../models/Tenant';

/**
 * requireApiKey — gate the read-only /api/integrations/* endpoints with a
 * long-lived API key instead of a short-lived admin JWT. External systems
 * (the operator's custom CRM) present the key in the `X-Api-Key` header (a
 * `Authorization: Bearer wbk_…` also works). We resolve the owning tenant from
 * the key and set req.tenant, so the SAME withTenantScope() helper the admin
 * routes use keeps every integration read isolated to that tenant.
 *
 * Pass required scopes to enforce them (a key with 'read:all' passes any). No
 * scopes means "any active key".
 */
export interface ApiKeyRequest extends Request {
  apiKey?: { id: string; name: string; scopes: ApiKeyScope[] };
  tenant?: ITenant;
}

export function requireApiKey(...requiredScopes: ApiKeyScope[]) {
  return async (
    req: ApiKeyRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const header = (req.headers['x-api-key'] as string | undefined) || '';
      const auth = req.headers['authorization'];
      const bearer =
        typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
          ? auth.slice(7).trim()
          : '';
      const raw = (header || bearer).trim();

      if (!raw || !raw.startsWith('wbk_')) {
        res.status(401).json({
          error: 'missing_api_key',
          message: 'Provide your API key in the X-Api-Key header.',
        });
        return;
      }

      const keyDoc = await ApiKey.findOne({
        keyHash: hashApiKey(raw),
        isActive: true,
      });
      if (!keyDoc) {
        res.status(401).json({ error: 'invalid_api_key' });
        return;
      }

      const scopes = (keyDoc.scopes || []) as ApiKeyScope[];
      const scoped =
        scopes.includes('read:all') ||
        requiredScopes.length === 0 ||
        requiredScopes.every((s) => scopes.includes(s));
      if (!scoped) {
        res
          .status(403)
          .json({ error: 'insufficient_scope', required: requiredScopes });
        return;
      }

      // Fail CLOSED: a tenant-scoped key whose tenant can't be resolved must be
      // rejected — never fall through to next() with req.tenant undefined, or
      // withTenantScope would return EVERY tenant's rows to this key.
      if (!keyDoc.tenantId) {
        res.status(403).json({ error: 'key_not_tenant_scoped' });
        return;
      }
      const tenant = await Tenant.findById(keyDoc.tenantId);
      if (!tenant) {
        res.status(403).json({ error: 'tenant_not_found' });
        return;
      }
      if ((tenant as ITenant).status === 'suspended') {
        res.status(403).json({ error: 'tenant_suspended' });
        return;
      }
      req.tenant = tenant;

      req.apiKey = { id: String(keyDoc._id), name: keyDoc.name, scopes };
      // Best-effort usage stamp — never block the request on it.
      ApiKey.updateOne(
        { _id: keyDoc._id },
        { $set: { lastUsedAt: new Date() } },
      ).catch(() => undefined);

      next();
    } catch (err) {
      console.error('apiKeyAuth failed:', err);
      res.status(500).json({ error: 'auth_error' });
    }
  };
}
