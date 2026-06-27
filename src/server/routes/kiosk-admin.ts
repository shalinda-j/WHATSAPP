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
import KioskInvite from '../../models/KioskInvite';
import { Contact } from '../../models/CRM';

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

/**
 * GET /api/kiosk-admin/invites
 *
 * Operator listing of the most-recent kiosk invites for the tenant. Joins the
 * linked Contact (one batched query) so the CRM list can show a friendly name,
 * phone and chosen course without N+1 lookups. Tenant-scoped with the legacy
 * null-tenant pattern so single-tenant / pre-migration rows stay visible.
 */
router.get('/invites', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant?._id ? String(req.tenant._id) : null;
    const q: Record<string, unknown> = {};
    if (tenantId) {
      q.$or = [
        { tenantId },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ];
    }

    const invites = await KioskInvite.find(q)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    // Batch-load every linked Contact in a single query, then index by id.
    const contactIds = Array.from(
      new Set(
        invites
          .map((inv: any) => (inv.contactId ? String(inv.contactId) : null))
          .filter((id): id is string => !!id),
      ),
    );

    const contactMap = new Map<string, any>();
    if (contactIds.length > 0) {
      const contacts = await Contact.find({ _id: { $in: contactIds } }).lean();
      for (const c of contacts as any[]) {
        contactMap.set(String(c._id), c);
      }
    }

    const readCustomField = (contact: any, key: string): string => {
      const cf = contact?.customFields;
      if (!cf) return '';
      // `customFields` is a Map of String; `.lean()` may surface it as a plain
      // object OR (rarely) keep Map semantics — handle both safely.
      if (typeof cf.get === 'function') return cf.get(key) || '';
      return cf[key] || '';
    };

    const rows = invites.map((inv: any) => {
      const contact = inv.contactId
        ? contactMap.get(String(inv.contactId))
        : undefined;

      const composedName = `${contact?.firstName || ''} ${
        contact?.lastName || ''
      }`.trim();
      const name =
        contact?.name || composedName || `Guest ${inv.code}`;

      const phone = inv.phone || contact?.phone || '';

      const course =
        inv.collected?.course?.program ||
        readCustomField(contact, 'course') ||
        '';

      return {
        _id: String(inv._id),
        code: inv.code,
        name,
        phone,
        course,
        status: inv.status,
        createdAt: inv.createdAt,
        completed: !!inv.completed,
      };
    });

    res.json({ invites: rows });
  } catch (err) {
    console.error(
      '❌ Kiosk invites list failed:',
      (err as any)?.message || err,
    );
    res.status(500).json({ error: 'Failed to list kiosk invites' });
  }
});

export default router;
