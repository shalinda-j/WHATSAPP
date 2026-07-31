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

/** Longest a hand-issued code may stay valid. */
export const MAX_VALID_DAYS = 90;

/**
 * Turn the form's "valid for N days" into an expiry date.
 *
 * Returns `{ expiresAt: undefined }` when the operator didn't choose one, so
 * `issue()` falls back to its own default TTL — the single place that lifetime
 * is defined. A walk-in visiting today wants a code that dies today; the 7-day
 * default only makes sense for a code sent ahead of a visit.
 */
export function parseValidDays(raw: unknown): {
  expiresAt?: Date;
  error?: string;
} {
  if (raw === undefined || raw === null || raw === '') return {};
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) {
    return { error: 'validDays must be a positive number of days' };
  }
  if (days > MAX_VALID_DAYS) {
    return { error: `validDays cannot exceed ${MAX_VALID_DAYS}` };
  }
  return { expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000) };
}

router.post('/invite', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;

    const contactId = str(body.contactId);
    const phone = str(body.phone);
    const sessionId = str(body.sessionId);
    const name = str(body.name);
    const course = str(body.course);
    const branch = str(body.branch);

    // A walk-in at the counter has no CRM record and may not have given a
    // number, so a name alone is enough to issue a code. The CRM "Issue code"
    // button still sends contactId/phone and behaves exactly as before.
    if (!contactId && !phone && !name) {
      res
        .status(400)
        .json({ error: 'Provide a contact, a phone number, or a name' });
      return;
    }

    const expiry = parseValidDays(body.validDays);
    if (expiry.error) {
      res.status(400).json({ error: expiry.error });
      return;
    }

    // Only attempt WhatsApp delivery when there's somewhere to deliver TO.
    // Asking for delivery on a walk-in with no number would silently do
    // nothing, and the operator would sit waiting for a message to arrive.
    const wantsDelivery = body.deliver !== false;

    const tenantId = req.tenant?._id ? String(req.tenant._id) : undefined;

    const { code, invite } = await kioskInviteService.issue({
      contactId,
      phone,
      tenantId,
      sessionId,
      name,
      course,
      branch,
      deliver: wantsDelivery,
      expiresAt: expiry.expiresAt,
    });

    res.status(201).json({
      code,
      status: invite?.status ?? 'issued',
      expiresAt: invite?.expiresAt,
      // Tell the operator whether a message actually went out, rather than
      // leaving them to guess from the absence of an error.
      delivered: !!(wantsDelivery && invite?.jid),
      branch: invite?.branch,
    });
  } catch (err) {
    console.error(
      '❌ Kiosk invite issue failed:',
      (err as any)?.message || err,
    );
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
      // `collected.personal.fullName` comes either from a hand-issued code
      // (the operator typed the walk-in's name) or from the consultant hearing
      // it during the visit. Without this the list showed "Guest 4821" for
      // every counter-issued code, which is exactly the row an operator most
      // needs to recognise.
      const seededName = inv.collected?.personal?.fullName || '';
      const name =
        contact?.name || composedName || seededName || `Guest ${inv.code}`;

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
