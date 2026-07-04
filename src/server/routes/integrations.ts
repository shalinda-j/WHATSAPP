import { Router, Response } from 'express';
import { requireApiKey, ApiKeyRequest } from '../middleware/apiKeyAuth';
import { withTenantScope } from '../middleware/tenantContext';
import Lead from '../../models/Lead';
import { Contact } from '../../models/CRM';
import Booking from '../../models/Booking';

/**
 * Public integration API for external systems (the operator's custom CRM).
 * Auth: a long-lived API key in the `X-Api-Key` header (see /api/api-keys).
 * Every read is tenant-scoped to the key's tenant.
 *
 * All list endpoints support:
 *   ?page=1&limit=100        pagination (limit capped at 200)
 *   ?updatedSince=<ISO date> incremental sync — only rows changed since then
 * and return { data, page, limit, count, hasMore, serverTime } so a CRM can
 * poll: keep the max updatedAt you saw and pass it back as updatedSince.
 */
const router = Router();

function parsePaging(req: ApiKeyRequest): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(
    200,
    Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100),
  );
  return { page, limit, skip: (page - 1) * limit };
}

function updatedSinceFilter(req: ApiKeyRequest): Record<string, unknown> {
  const raw = req.query.updatedSince;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  const d = new Date(raw);
  if (isNaN(d.getTime())) return {};
  return { updatedAt: { $gte: d } };
}

// ── Directory / self-doc ─────────────────────────────────────────────────────
router.get('/', requireApiKey(), (req: ApiKeyRequest, res: Response) => {
  res.json({
    ok: true,
    tenant: req.tenant?.slug ?? null,
    key: req.apiKey?.name ?? null,
    endpoints: [
      'GET /api/integrations/leads?page=&limit=&updatedSince=',
      'GET /api/integrations/contacts?page=&limit=&updatedSince=',
      'GET /api/integrations/bookings?page=&limit=&updatedSince=',
    ],
    auth: 'Send your key as the X-Api-Key header.',
  });
});

// ── Leads ────────────────────────────────────────────────────────────────────
router.get('/leads', requireApiKey('read:leads'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const filter = withTenantScope(req, updatedSinceFilter(req));
    const [rows, count] = await Promise.all([
      Lead.find(filter).sort({ updatedAt: 1 }).skip(skip).limit(limit).lean(),
      Lead.countDocuments(filter),
    ]);
    const data = (rows as any[]).map((r) => ({
      id: String(r._id),
      name: r.fullName ?? '',
      phone: r.phoneNumber ?? '',
      email: r.email ?? '',
      age: r.age ?? null,
      country: r.interestedCountry ?? '',
      jobType: r.jobVacancyType ?? '',
      experience: r.experienceYears ?? '',
      status: r.status ?? '',
      source: r.source ?? '',
      notes: r.notes ?? '',
      registeredAt: r.registeredAt ?? r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    }));
    res.json({
      data,
      page,
      limit,
      count,
      hasMore: skip + rows.length < count,
      serverTime: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'leads_failed' });
  }
});

// ── CRM Contacts ─────────────────────────────────────────────────────────────
router.get('/contacts', requireApiKey('read:contacts'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const filter = withTenantScope(req, updatedSinceFilter(req));
    const [rows, count] = await Promise.all([
      Contact.find(filter).sort({ updatedAt: 1 }).skip(skip).limit(limit).lean(),
      Contact.countDocuments(filter),
    ]);
    const data = (rows as any[]).map((r) => ({
      id: String(r._id),
      name: r.name || `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
      firstName: r.firstName ?? '',
      lastName: r.lastName ?? '',
      phone: r.phone ?? r.whatsappNumber ?? '',
      email: r.email ?? '',
      type: r.type ?? '',
      status: r.status ?? '',
      source: r.source ?? '',
      // customFields is a Map<String>; .lean() surfaces it as a plain object.
      customFields:
        r.customFields && typeof r.customFields === 'object'
          ? r.customFields
          : {},
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    }));
    res.json({
      data,
      page,
      limit,
      count,
      hasMore: skip + rows.length < count,
      serverTime: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'contacts_failed' });
  }
});

// ── Bookings ─────────────────────────────────────────────────────────────────
router.get('/bookings', requireApiKey('read:bookings'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const filter = withTenantScope(req, updatedSinceFilter(req));
    const [rows, count] = await Promise.all([
      Booking.find(filter).sort({ updatedAt: 1 }).skip(skip).limit(limit).lean(),
      Booking.countDocuments(filter),
    ]);
    const data = (rows as any[]).map((r) => ({
      id: String(r._id),
      clientName: r.clientName ?? '',
      clientPhone: r.clientPhone ?? '',
      date: r.date ?? null,
      time: r.time ?? '',
      type: r.type ?? '',
      status: r.status ?? '',
      location: r.location ?? '',
      kioskCode: r.kioskCode ?? '',
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    }));
    res.json({
      data,
      page,
      limit,
      count,
      hasMore: skip + rows.length < count,
      serverTime: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'bookings_failed' });
  }
});

export default router;
