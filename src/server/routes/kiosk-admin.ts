/**
 * Operator-facing kiosk invite endpoint.
 *
 *   POST /api/kiosk-admin/invite  body { contactId?, phone?, sessionId? }
 *     → issues a short-lived 4-digit kiosk code for a customer, delivers it
 *       over WhatsApp best-effort, and returns { code, status, expiresAt }.
 *
 * Mounted behind `authenticateToken` + `resolveTenant` in src/server/app.ts,
 * so `req.tenant` is always populated here. This backs the CRM "Issue code"
 * button.
 */
import { Router, Request, Response } from 'express';
import { kioskInviteService } from '../../services/KioskInviteService';

const router = Router();

router.post('/invite', async (req: Request, res: Response) => {
  try {
    const { contactId, phone, sessionId } = (req.body || {}) as {
      contactId?: string;
      phone?: string;
      sessionId?: string;
    };

    // Need at least one way to resolve the customer.
    if (!contactId && !phone) {
      res.status(400).json({ error: 'contactId or phone is required' });
      return;
    }

    const tenantId = req.tenant?._id ? String(req.tenant._id) : undefined;

    const { code, invite } = await kioskInviteService.issue({
      contactId: typeof contactId === 'string' ? contactId : undefined,
      phone: typeof phone === 'string' ? phone : undefined,
      tenantId,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    });

    res.status(201).json({
      code,
      status: invite?.status ?? 'issued',
      expiresAt: invite?.expiresAt,
    });
  } catch (err) {
    console.error('❌ Kiosk invite issue failed:', (err as any)?.message || err);
    res.status(500).json({ error: 'Failed to issue kiosk code' });
  }
});

export default router;
