import express, { Request, Response } from 'express';
import { computeBulkSla, computeUserSla, DEFAULT_SLA_MS } from '../../services/slaTracker';

const router = express.Router();

/**
 * SLA snapshot for a single user (by WhatsApp JID / external user id).
 * Useful for the chat view to surface a breach badge inline.
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const slaMs = Number(req.query.slaMs) || DEFAULT_SLA_MS;
    const snap = await computeUserSla(String(req.params.userId), slaMs);
    res.json({ success: true, snapshot: snap, slaMs });
  } catch (err: any) {
    console.error('sla user route failed:', err);
    res.status(500).json({ error: err?.message ?? 'sla_failed' });
  }
});

/**
 * Bulk SLA lookup. Accepts a JSON body of { userIds: string[], slaMs?: number }
 * and returns a map keyed by userId. Capped at 200 ids per call so a
 * misbehaving frontend can't force a 10k-row scan.
 */
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const ids = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    if (ids.length > 200) {
      return res.status(400).json({ error: 'too_many_ids', limit: 200 });
    }
    const slaMs = Number(req.body?.slaMs) || DEFAULT_SLA_MS;
    const map = await computeBulkSla(ids.map(String), slaMs);
    res.json({
      success: true,
      slaMs,
      snapshots: Object.fromEntries(map.entries()),
    });
  } catch (err: any) {
    console.error('sla bulk route failed:', err);
    res.status(500).json({ error: err?.message ?? 'sla_failed' });
  }
});

export default router;
