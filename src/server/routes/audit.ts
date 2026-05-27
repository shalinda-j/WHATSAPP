import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import AuditEvent from '../../models/AuditEvent';

const router = express.Router();

/**
 * Read-only audit log endpoint. Returns the most recent audit events
 * scoped to the caller's tenant. Operators querying without a tenant
 * scope (super-admin) see global events.
 *
 * Query params:
 *   limit   — max rows (default 100, capped at 500)
 *   before  — ISO timestamp for cursor pagination (older-than)
 *   admin   — filter by adminUsername
 *   method  — POST|PUT|PATCH|DELETE
 *   path    — substring match on path
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const before = req.query.before
      ? new Date(String(req.query.before))
      : undefined;
    const admin = req.query.admin ? String(req.query.admin) : undefined;
    const method = req.query.method ? String(req.query.method) : undefined;
    const pathSubstr = req.query.path ? String(req.query.path) : undefined;

    const filter: Record<string, unknown> = {};
    const tenant = (req as any).tenant;
    if (tenant?._id) {
      filter.tenantId = new mongoose.Types.ObjectId(String(tenant._id));
    }
    if (admin) filter.adminUsername = admin;
    if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      filter.method = method;
    }
    if (pathSubstr) {
      filter.path = {
        $regex: pathSubstr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      };
    }
    if (before && !Number.isNaN(before.getTime())) {
      filter.createdAt = { $lt: before };
    }

    const events = await AuditEvent.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ events, count: events.length });
  } catch (err: any) {
    console.error('audit log query failed:', err);
    res.status(500).json({ error: err?.message ?? 'audit_query_failed' });
  }
});

export default router;
