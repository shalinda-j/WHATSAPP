import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import {
  resolveTenant,
  withTenantScope,
  tenantIdOf,
} from '../middleware/tenantContext';
import ApiKey, {
  generateRawApiKey,
  hashApiKey,
  ApiKeyScope,
} from '../../models/ApiKey';

/**
 * Admin CRUD for integration API keys. Mounted behind authenticateToken +
 * resolveTenant, so an operator manages ONLY their own tenant's keys from the
 * dashboard. The raw key is returned exactly ONCE (on create); afterwards only
 * a masked prefix is ever exposed.
 */
const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

const VALID_SCOPES: ApiKeyScope[] = [
  'read:leads',
  'read:contacts',
  'read:bookings',
  'read:all',
];

function redact(doc: any) {
  return {
    id: String(doc._id),
    name: doc.name,
    keyPrefix: doc.keyPrefix,
    scopes: doc.scopes,
    isActive: doc.isActive,
    lastUsedAt: doc.lastUsedAt ?? null,
    createdAt: doc.createdAt,
  };
}

// List this tenant's keys (never returns the raw key or hash).
router.get('/', async (req: Request, res: Response) => {
  try {
    const keys = await ApiKey.find(withTenantScope(req, {}))
      .sort({ createdAt: -1 })
      .lean();
    res.json({ keys: (keys as any[]).map(redact) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'list_failed' });
  }
});

// Create a key → returns the RAW key once. Store it now; it can't be shown again.
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    let scopes: ApiKeyScope[] = Array.isArray(req.body?.scopes)
      ? (req.body.scopes as string[]).filter((s): s is ApiKeyScope =>
          (VALID_SCOPES as string[]).includes(s),
        )
      : [];
    if (scopes.length === 0) scopes = ['read:all'];

    const rawKey = generateRawApiKey();
    const doc = await ApiKey.create({
      name,
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.slice(0, 12),
      scopes,
      tenantId: tenantIdOf(req) as never,
      createdBy: (req.user as { userId?: string })?.userId,
    } as never);

    res.status(201).json({
      ...redact(doc),
      // Shown ONCE — the operator must copy it now.
      key: rawKey,
      message:
        'Copy this key now — it will not be shown again. Send it as the X-Api-Key header.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'create_failed' });
  }
});

// Revoke (soft-disable) a key.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const doc = await ApiKey.findOneAndUpdate(
      withTenantScope(req, { _id: req.params.id }),
      { $set: { isActive: false } },
      { returnDocument: 'after' },
    );
    if (!doc) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true, ...redact(doc) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'revoke_failed' });
  }
});

export default router;
