import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Lead from '../../models/Lead';
import { Contact } from '../../models/CRM';
import CampaignExecution from '../../models/CampaignExecution';
import Booking from '../../models/Booking';
import ChatMessage from '../../models/ChatMessage';
import { toCsv, csvDownloadHeaders } from '../utils/csv';
import { extractRealPhone, isLidJid } from '../../utils/jid';
import {
  loadPhoneMapForLids,
  normaliseLidJid,
} from '../../services/LidPhoneMappingService';
import Session from '../../models/Session';
import { withTenantScope } from '../middleware/tenantContext';

const router = express.Router();

const MAX_EXPORT_ROWS = 50_000;

type ContactPhoneFields = {
  phone?: string | null;
  whatsappNumber?: string | null;
  whatsappId?: string | null;
};

function contactIdentifierCandidates(contact: ContactPhoneFields): string[] {
  const out = new Set<string>();
  for (const raw of [
    contact.phone,
    contact.whatsappNumber,
    contact.whatsappId,
  ]) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const value = raw.trim();
    out.add(value);
    if (value.startsWith('+')) out.add(value.slice(1));
  }
  return Array.from(out);
}

function formatExportPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

export function resolveContactExportPhone(
  contact: ContactPhoneFields,
  realPhoneByIdentifier: Map<string, string> = new Map(),
): string {
  for (const raw of [
    contact.phone,
    contact.whatsappNumber,
    contact.whatsappId,
  ]) {
    const phone = extractRealPhone(raw);
    if (phone) return `+${phone}`;
  }

  for (const candidate of contactIdentifierCandidates(contact)) {
    // The stored mapping may be keyed by any of: the raw value, the value
    // without a leading '+', the normalised `<digits>@lid` form, or the bare
    // local digits (older rows persisted the suffix-less identifier). Try all
    // so a LID contact resolves regardless of which shape was saved.
    const bareDigits = candidate.split('@')[0]?.replace(/\D/g, '') ?? '';
    const phone =
      realPhoneByIdentifier.get(candidate) ??
      realPhoneByIdentifier.get(candidate.replace(/^\+/, '')) ??
      realPhoneByIdentifier.get(normaliseLidJid(candidate) ?? '') ??
      // Tolerate mappings keyed by the bare local part (no @lid suffix):
      // loadPhoneMapForLids stores both forms, but a manually-built or
      // legacy map may only carry the suffix-less key.
      realPhoneByIdentifier.get(candidate.replace(/@lid$/i, '')) ??
      (bareDigits ? realPhoneByIdentifier.get(bareDigits) : undefined);
    if (phone) return formatExportPhone(phone);
  }

  return '';
}

/* -------------------------------------------------------------------------
 * Contact-export filtering (date/time window + attribute filters)
 * ---------------------------------------------------------------------- */

/** Date fields a contact export may be windowed on. */
export const CONTACT_EXPORT_DATE_FIELDS = [
  'createdAt',
  'updatedAt',
  'lastContact',
  'nextFollowUp',
] as const;

export type ContactExportDateField =
  (typeof CONTACT_EXPORT_DATE_FIELDS)[number];

/** Whitelist the caller-supplied date field; anything else → createdAt. */
export function resolveContactDateField(raw: unknown): ContactExportDateField {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return (CONTACT_EXPORT_DATE_FIELDS as readonly string[]).includes(value)
    ? (value as ContactExportDateField)
    : 'createdAt';
}

/**
 * Parse one edge of an export window into a Date.
 *
 * Accepted shapes, in order of specificity:
 *   YYYY-MM-DD          → UTC start (00:00:00.000) / end (23:59:59.999) of day
 *   YYYY-MM             → UTC start / end of the calendar month
 *   YYYY-MM-DDTHH:mm    → that minute in UTC; the `end` edge covers the whole
 *                         minute (…:59.999) so a picked end-time is inclusive
 *   any ISO-8601 string → parsed as-is (offsets like `+05:30` / `Z` honoured)
 *
 * Naive (zone-less) inputs are read as UTC on purpose — the rest of the
 * export layer windows in UTC, and the admin UI sends fully-qualified ISO
 * timestamps so the operator's local pick maps to the exact instant.
 *
 * Returns null for empty / unparsable input so callers can skip the clause.
 */
export function parseExportDateBoundary(
  raw: unknown,
  edge: 'start' | 'end',
): Date | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '') return null;

  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split('-').map(Number);
    return edge === 'start'
      ? new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
      : new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - 1);
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    if (edge === 'end') parsed.setUTCHours(23, 59, 59, 999);
    return parsed;
  }

  // YYYY-MM-DDTHH:mm(:ss) with no timezone designator → treat as UTC.
  const naive = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(value);
  if (naive) {
    const seconds = naive[3] ?? (edge === 'end' ? ':59' : ':00');
    const millis = edge === 'end' && !naive[3] ? '.999' : '.000';
    const parsed = new Date(`${naive[1]}T${naive[2]}${seconds}${millis}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Build the Mongo range operator for a date window. Returns null when
 * neither edge is usable, and swaps the edges when the operator picks them
 * backwards (a reversed range would otherwise silently return zero rows).
 */
export function buildExportDateRange(
  fromRaw: unknown,
  toRaw: unknown,
): { $gte?: Date; $lte?: Date } | null {
  let from = parseExportDateBoundary(fromRaw, 'start');
  let to = parseExportDateBoundary(toRaw, 'end');
  if (!from && !to) return null;
  if (from && to && from.getTime() > to.getTime()) {
    // Re-parse rather than swap the Dates: each edge carries its own
    // day-rounding (start → 00:00:00.000, end → 23:59:59.999), so swapping
    // the parsed values would hand back a window shifted by a day.
    from = parseExportDateBoundary(toRaw, 'start');
    to = parseExportDateBoundary(fromRaw, 'end');
  }
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return range;
}

/** Escape regex metacharacters so a search term can't inject a pattern. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Merge filter clauses without one `$or` clobbering another — the tenant
 * scope, the device scope and the free-text search each need their own.
 */
function combineFilters(
  base: Record<string, unknown>,
  ...clauses: Array<Record<string, unknown>>
): Record<string, unknown> {
  const nonEmpty = clauses.filter((c) => Object.keys(c).length > 0);
  if (nonEmpty.length === 0) return base;
  if (nonEmpty.length === 1) return { ...base, ...nonEmpty[0] };
  return { ...base, $and: nonEmpty };
}

export type ContactExportQuery = {
  tenantId?: string | null;
  sessionId?: string | null;
  status?: unknown;
  type?: unknown;
  source?: unknown;
  priority?: unknown;
  tags?: unknown;
  search?: unknown;
  dateField?: unknown;
  from?: unknown;
  to?: unknown;
  /** 'exclude' drops opted-out contacts; 'only' keeps just those. */
  optedOut?: unknown;
};

/**
 * Compile the Contacts-export filter panel into a Mongo query. Pure so the
 * date-window and clause-merging behaviour is unit-testable without a DB.
 */
export function buildContactExportFilter(params: ContactExportQuery): {
  filter: Record<string, unknown>;
  dateField: ContactExportDateField;
} {
  const dateField = resolveContactDateField(params.dateField);
  const base: Record<string, unknown> = {};

  const str = (v: unknown): string =>
    typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();

  if (str(params.status)) base.status = str(params.status);
  if (str(params.type)) base.type = str(params.type);
  if (str(params.source)) base.source = str(params.source);
  if (str(params.priority)) base.priority = str(params.priority);

  const tags = (Array.isArray(params.tags) ? params.tags : [params.tags])
    .flatMap((t) => str(t).split(','))
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length > 0) base.tags = { $in: tags };

  const optedOut = str(params.optedOut).toLowerCase();
  if (optedOut === 'exclude' || optedOut === 'false')
    base.optedOut = { $ne: true };
  else if (optedOut === 'only' || optedOut === 'true') base.optedOut = true;

  const range = buildExportDateRange(params.from, params.to);
  if (range) base[dateField] = range;

  // Legacy-tolerant scopes: rows created before tenantId / sessionId existed
  // must still export, otherwise old contacts silently vanish from the sheet.
  const tenantId = str(params.tenantId);
  const tenantClause: Record<string, unknown> = tenantId
    ? {
        $or: [
          { tenantId: new mongoose.Types.ObjectId(tenantId) },
          { tenantId: { $exists: false } },
          { tenantId: null },
        ],
      }
    : {};

  const sessionId = str(params.sessionId);
  const sessionClause: Record<string, unknown> =
    sessionId && sessionId !== 'all'
      ? { $or: [{ sessionId }, { sessionId: { $exists: false } }] }
      : {};

  const search = str(params.search);
  const searchClause: Record<string, unknown> = search
    ? {
        $or: [
          { name: { $regex: escapeRegex(search), $options: 'i' } },
          { firstName: { $regex: escapeRegex(search), $options: 'i' } },
          { lastName: { $regex: escapeRegex(search), $options: 'i' } },
          { email: { $regex: escapeRegex(search), $options: 'i' } },
          { phone: { $regex: escapeRegex(search), $options: 'i' } },
          { whatsappNumber: { $regex: escapeRegex(search), $options: 'i' } },
          { company: { $regex: escapeRegex(search), $options: 'i' } },
        ],
      }
    : {};

  return {
    filter: combineFilters(base, tenantClause, sessionClause, searchClause),
    dateField,
  };
}

/**
 * Filename that records what the sheet actually contains — which date axis
 * was used, the window, and the device scope. Operators keep several of
 * these side by side, so `crm-contacts-2026-07-01_2026-07-25.csv` beats a
 * folder full of `crm-contacts-<today>.csv`.
 */
export function buildContactExportFilename(
  dateField: ContactExportDateField,
  fromRaw: unknown,
  toRaw: unknown,
  sessionId?: unknown,
): string {
  const parts: string[] = ['crm-contacts'];
  if (typeof sessionId === 'string' && sessionId && sessionId !== 'all') {
    parts.push(sessionId);
  }
  const from = parseExportDateBoundary(fromRaw, 'start');
  const to = parseExportDateBoundary(toRaw, 'end');
  if (from || to) {
    if (dateField !== 'createdAt') parts.push(dateField);
    const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'any');
    parts.push(`${fmt(from)}_${fmt(to)}`);
  } else {
    parts.push(new Date().toISOString().slice(0, 10));
  }
  return `${parts.join('-')}.csv`;
}

/**
 * Streamable export endpoints. The current implementation materialises the
 * full result into memory before serialising — fine for ≤50k rows on a
 * typical admin workstation. Anything larger should switch to the cursor
 * stream below, but that's a Phase 4 lift once we see real demand.
 */

router.get('/leads.csv', async (req: Request, res: Response) => {
  try {
    const tenant = (req as any).tenant;
    const filter: Record<string, unknown> = {};
    if (tenant?._id) {
      filter.$or = [
        { tenantId: new mongoose.Types.ObjectId(String(tenant._id)) },
        { tenantId: { $exists: false } },
      ];
    }
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.jobVacancyType) {
      filter.jobVacancyType = String(req.query.jobVacancyType);
    }

    const rows = await Lead.find(filter)
      .sort({ registeredAt: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean();

    const flat = rows.map((r: any) => ({
      id: String(r._id),
      fullName: r.fullName,
      phoneNumber: r.phoneNumber,
      email: r.email ?? '',
      age: r.age ?? '',
      interestedCountry: r.interestedCountry ?? '',
      jobVacancyType: r.jobVacancyType,
      status: r.status,
      source: r.source,
      registeredAt: r.registeredAt,
      updatedAt: r.updatedAt,
      qualificationCount: Array.isArray(r.qualifications)
        ? r.qualifications.length
        : 0,
      notes: r.notes ?? '',
    }));

    const csv = toCsv(flat, [
      'id',
      'fullName',
      'phoneNumber',
      'email',
      'age',
      'interestedCountry',
      'jobVacancyType',
      'status',
      'source',
      'registeredAt',
      'updatedAt',
      'qualificationCount',
      'notes',
    ]);
    res
      .set(
        csvDownloadHeaders(
          `leads-${new Date().toISOString().slice(0, 10)}.csv`,
        ),
      )
      .send(csv);
  } catch (err: any) {
    console.error('export leads.csv failed:', err);
    res.status(500).json({ error: err?.message ?? 'export_failed' });
  }
});

/**
 * Translate the request's query string into the contact-export filter.
 * Shared by /contacts.csv and /contacts.count so the preview count the
 * operator sees in the filter panel always matches the downloaded sheet.
 */
function contactExportFilterFromRequest(req: Request) {
  const tenant = (req as any).tenant;
  return buildContactExportFilter({
    tenantId: tenant?._id ? String(tenant._id) : null,
    sessionId:
      typeof req.query.sessionId === 'string' ? req.query.sessionId : null,
    status: req.query.status,
    type: req.query.type,
    source: req.query.source,
    priority: req.query.priority,
    tags: req.query.tags,
    search: req.query.search,
    dateField: req.query.dateField,
    from: req.query.from,
    to: req.query.to,
    optedOut: req.query.optedOut,
  });
}

/**
 * GET /api/export/contacts.count
 *
 * Row count for the current filter selection — lets the export panel show
 * "N contacts match" before the operator commits to a download. Same filter
 * compiler as /contacts.csv, so the number is never a lie.
 */
router.get('/contacts.count', async (req: Request, res: Response) => {
  try {
    const { filter, dateField } = contactExportFilterFromRequest(req);
    const total = await (Contact as any).countDocuments(filter);
    res.json({
      total,
      dateField,
      capped: total > MAX_EXPORT_ROWS,
      maxRows: MAX_EXPORT_ROWS,
    });
  } catch (err: any) {
    console.error('contacts.count failed:', err);
    res.status(500).json({ error: err?.message ?? 'count_failed' });
  }
});

router.get('/contacts.csv', async (req: Request, res: Response) => {
  try {
    const { filter, dateField } = contactExportFilterFromRequest(req);

    const rows = (await (Contact as any)
      .find(filter)
      // Sort on the field the window was applied to, so a date-filtered
      // sheet reads newest-first along the same axis the operator picked.
      .sort({ [dateField]: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean()) as any[];

    const identifierSet = new Set<string>();
    for (const row of rows) {
      for (const id of contactIdentifierCandidates(row)) identifierSet.add(id);
    }
    const identifiers = Array.from(identifierSet);
    const realPhoneByIdentifier = new Map<string, string>();
    const sessionId =
      typeof req.query.sessionId === 'string' && req.query.sessionId !== 'all'
        ? req.query.sessionId
        : undefined;
    if (identifiers.length > 0) {
      const resolved = (await ChatMessage.aggregate([
        {
          $match: withTenantScope(req, {
            userId: { $in: identifiers },
            'metadata.realPhone': { $exists: true, $ne: '' },
          }),
        },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$userId',
            realPhone: { $first: '$metadata.realPhone' },
          },
        },
      ])) as Array<{ _id: string; realPhone: string }>;
      for (const row of resolved) {
        if (row.realPhone) realPhoneByIdentifier.set(row._id, row.realPhone);
      }

      const mappedPhones = await loadPhoneMapForLids(identifiers, sessionId);
      for (const [lid, phone] of mappedPhones) {
        realPhoneByIdentifier.set(lid, phone);
      }
    }

    const flat = rows.map((r: any) => ({
      id: String(r._id),
      name: r.name,
      email: r.email ?? '',
      phone: resolveContactExportPhone(r, realPhoneByIdentifier),
      company: r.company ?? '',
      type: r.type,
      status: r.status,
      priority: r.priority,
      source: r.source,
      whatsappOptIn: r.whatsappOptIn,
      tags: Array.isArray(r.tags) ? r.tags.join(';') : '',
      lastContact: r.lastContact ?? '',
      nextFollowUp: r.nextFollowUp ?? '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    const csv = toCsv(flat, [
      'id',
      'name',
      'email',
      'phone',
      'company',
      'type',
      'status',
      'priority',
      'source',
      'whatsappOptIn',
      'tags',
      'lastContact',
      'nextFollowUp',
      'createdAt',
      'updatedAt',
    ]);
    res
      .set(
        csvDownloadHeaders(
          buildContactExportFilename(
            dateField,
            req.query.from,
            req.query.to,
            req.query.sessionId,
          ),
        ),
      )
      .send(csv);
  } catch (err: any) {
    console.error('export contacts.csv failed:', err);
    res.status(500).json({ error: err?.message ?? 'export_failed' });
  }
});

router.get(
  '/campaigns/:campaignId/executions.csv',
  async (req: Request, res: Response) => {
    try {
      const tenant = (req as any).tenant;
      const filter: Record<string, unknown> = {
        campaignId: new mongoose.Types.ObjectId(String(req.params.campaignId)),
      };
      if (tenant?._id) {
        filter.tenantId = new mongoose.Types.ObjectId(String(tenant._id));
      }

      const rows = await CampaignExecution.find(filter)
        .sort({ createdAt: -1 })
        .limit(MAX_EXPORT_ROWS)
        .lean();

      const flat = rows.map((r: any) => ({
        id: String(r._id),
        contactId: r.contactId ? String(r.contactId) : '',
        variantId: r.variantId ?? '',
        channel: r.channel,
        recipient: r.recipientExternalId,
        status: r.status,
        attemptCount: r.attemptCount ?? 0,
        sentAt: r.sentAt ?? '',
        deliveredAt: r.deliveredAt ?? '',
        readAt: r.readAt ?? '',
        outcome: r.outcome ?? '',
        errorMessage: r.errorMessage ?? '',
        externalMessageId: r.externalMessageId ?? '',
        createdAt: r.createdAt,
      }));

      const csv = toCsv(flat, [
        'id',
        'contactId',
        'variantId',
        'channel',
        'recipient',
        'status',
        'attemptCount',
        'sentAt',
        'deliveredAt',
        'readAt',
        'outcome',
        'errorMessage',
        'externalMessageId',
        'createdAt',
      ]);
      res
        .set(
          csvDownloadHeaders(
            `campaign-${req.params.campaignId}-executions.csv`,
          ),
        )
        .send(csv);
    } catch (err: any) {
      console.error('export campaign executions failed:', err);
      res.status(500).json({ error: err?.message ?? 'export_failed' });
    }
  },
);

/**
 * Live-chat real-number export — distinct phone numbers (digits stripped
 * from the WhatsApp JID) that messaged the bot, optionally scoped to:
 *
 *   sessionId — the WhatsApp session (device) the conversation arrived on
 *   month     — YYYY-MM, uses the full calendar month in UTC
 *   from / to — explicit ISO date range (overrides month when both set)
 *
 * Each row carries: phone, lastSeen, messageCount, firstSeen, deviceSession,
 * plus the matching Contact's name/email/optedOut flag when present so the
 * operator can dial straight from the export without a second lookup.
 *
 * Implementation:
 *   1. Aggregate ChatMessage by userId in the window — single index scan
 *      on (userId, timestamp) returns count + min/max timestamps per JID.
 *   2. Pull matching Contacts in one $or query keyed off the unique phone
 *      digits — O(1) round-trip instead of N per JID.
 *   3. CSV-serialise with the existing toCsv helper.
 */
router.get('/chat-numbers.csv', async (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId
      ? String(req.query.sessionId).trim()
      : '';
    const month = req.query.month ? String(req.query.month).trim() : '';
    const fromRaw = req.query.from ? String(req.query.from).trim() : '';
    const toRaw = req.query.to ? String(req.query.to).trim() : '';

    // Default behaviour: include unresolved rows too. Operators use this
    // export to split conversations by country/device, so an empty sheet is
    // worse than a row with a raw LID and message context.
    const includeUnresolved =
      String(req.query.includeUnresolved ?? 'true').toLowerCase() !== 'false';

    // Resolve the time window — explicit from/to wins; otherwise parse
    // YYYY-MM into a UTC calendar-month range; otherwise no window (all-time).
    let from: Date | undefined;
    let to: Date | undefined;
    if (fromRaw) {
      const d = new Date(fromRaw);
      if (!Number.isNaN(d.getTime())) from = d;
    }
    if (toRaw) {
      const d = new Date(toRaw);
      if (!Number.isNaN(d.getTime())) to = d;
    }
    if (!from && !to && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      from = new Date(Date.UTC(y, m - 1, 1));
      to = new Date(Date.UTC(y, m, 1));
    }

    const sessionLabelById = new Map<string, string>();
    if (sessionId && sessionId !== 'all') {
      const selectedSession = await Session.findOne({
        $or: [{ sessionId }, { sessionName: sessionId }],
      }).lean();
      if (selectedSession?.sessionId) {
        sessionLabelById.set(
          selectedSession.sessionId,
          selectedSession.sessionName || selectedSession.sessionId,
        );
      }
    }
    const scopedSessionIds = Array.from(sessionLabelById.keys());

    const match: Record<string, unknown> = { role: 'user' };
    if (sessionId && sessionId !== 'all') {
      match['metadata.sessionId'] =
        scopedSessionIds.length > 0 ? { $in: scopedSessionIds } : sessionId;
    }
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lt = to;
      match.timestamp = range;
    }

    type Agg = {
      _id: string;
      messageCount: number;
      firstSeen: Date;
      lastSeen: Date;
      sessionIds: (string | null | undefined)[];
      realPhones: (string | null | undefined)[];
      pushNames: (string | null | undefined)[];
      lastMessage: string;
    };

    const agg = (await ChatMessage.aggregate([
      { $match: withTenantScope(req, match) },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$userId',
          messageCount: { $sum: 1 },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' },
          sessionIds: { $addToSet: '$metadata.sessionId' },
          realPhones: { $addToSet: '$metadata.realPhone' },
          pushNames: { $addToSet: '$metadata.pushName' },
          lastMessage: { $first: '$content' },
        },
      },
      { $sort: { lastSeen: -1 } },
      { $limit: MAX_EXPORT_ROWS },
    ])) as Agg[];

    if (agg.length === 0) {
      const empty = toCsv(
        [],
        [
          'phone',
          'name',
          'email',
          'identifierType',
          'rawJid',
          'lastSeen',
          'firstSeen',
          'messageCount',
          'deviceSessions',
          'optedOut',
        ],
      );
      res
        .set(csvDownloadHeaders(buildFilename(sessionId, month, from, to)))
        .send(empty);
      return;
    }

    // Map each userId to a *real* E.164-style phone or null. Priority:
    //   1. metadata.realPhone collected across the message window (lifted
    //      from Baileys senderPn / participantPn at ingest)
    //   2. extractRealPhone(userId) for @s.whatsapp.net JIDs
    // LIDs with no realPhone anywhere stay null — we never coerce them
    // into the phone column because operators would dial them and get
    // nothing.
    const phoneByUserId = new Map<string, string | null>(
      agg.map((row) => {
        const fromMetadata = (row.realPhones || []).find(
          (p): p is string => typeof p === 'string' && p.length > 0,
        );
        if (fromMetadata) return [row._id, fromMetadata];
        return [row._id, extractRealPhone(row._id)];
      }),
    );
    const mappedPhones = await loadPhoneMapForLids(
      agg.map((row) => row._id),
      scopedSessionIds[0] || (sessionId !== 'all' ? sessionId : undefined),
    );
    for (const [lid, phone] of mappedPhones) {
      const lidJid = normaliseLidJid(lid);
      if (
        lidJid &&
        (!phoneByUserId.get(lidJid) || !phoneByUserId.has(lidJid))
      ) {
        phoneByUserId.set(lidJid, phone);
      }
      if (phoneByUserId.has(lid)) phoneByUserId.set(lid, phone);
    }
    const distinctDigits = Array.from(
      new Set(
        Array.from(phoneByUserId.values()).filter((p): p is string =>
          Boolean(p),
        ),
      ),
    );

    // One bounded contact lookup for every phone in the export — much cheaper
    // than N findOne calls. Tenant scope is honoured when present, with a
    // fallback to legacy rows that haven't been backfilled with tenantId yet
    // (same shape /contacts.csv uses).
    type ContactLite = {
      name?: string;
      email?: string;
      phone?: string;
      whatsappNumber?: string;
      whatsappId?: string;
      optedOut?: boolean;
    };
    const contactsByPhone = new Map<string, ContactLite>();
    if (distinctDigits.length > 0) {
      const tenant = (req as any).tenant;
      const tenantFilter = tenant?._id
        ? {
            $or: [
              { tenantId: new mongoose.Types.ObjectId(String(tenant._id)) },
              { tenantId: { $exists: false } },
            ],
          }
        : {};
      const contactQuery = {
        ...tenantFilter,
        $or: [
          { phone: { $in: distinctDigits } },
          { whatsappNumber: { $in: distinctDigits } },
          { whatsappId: { $in: distinctDigits } },
        ],
      } as Record<string, unknown>;
      const contacts = (await (Contact as any)
        .find(contactQuery, {
          name: 1,
          email: 1,
          phone: 1,
          whatsappNumber: 1,
          whatsappId: 1,
          optedOut: 1,
        })
        .lean()) as ContactLite[];
      for (const c of contacts) {
        for (const key of ['phone', 'whatsappNumber', 'whatsappId'] as const) {
          const v = (c[key] || '').replace(/\D/g, '');
          if (v && !contactsByPhone.has(v)) contactsByPhone.set(v, c);
        }
      }
    }

    const rows = agg
      .map((r) => {
        const phone = phoneByUserId.get(r._id) || '';
        const contact = phone ? contactsByPhone.get(phone) : undefined;
        const deviceSessions = (r.sessionIds || []).filter((s): s is string =>
          Boolean(s),
        );
        const deviceLabels = deviceSessions.map(
          (s) => sessionLabelById.get(s) || s,
        );
        const fallbackName = (r.pushNames || []).find(
          (n): n is string => typeof n === 'string' && n.length > 0,
        );
        const country = inferCountryForExport(
          r.lastMessage,
          deviceLabels.join(' '),
        );
        return {
          phone,
          name: contact?.name ?? fallbackName ?? '',
          email: contact?.email ?? '',
          identifierType: phone ? 'phone' : isLidJid(r._id) ? 'lid' : 'unknown',
          rawJid: r._id,
          country,
          lastMessage: r.lastMessage ?? '',
          lastSeen: r.lastSeen,
          firstSeen: r.firstSeen,
          messageCount: r.messageCount,
          deviceSessions: deviceSessions.join(';'),
          devices: deviceLabels.join(';'),
          optedOut: contact?.optedOut ? 'true' : '',
        };
      })
      .filter((row) => includeUnresolved || Boolean(row.phone));

    const csv = toCsv(rows, [
      'phone',
      'name',
      'email',
      'identifierType',
      'rawJid',
      'country',
      'lastMessage',
      'lastSeen',
      'firstSeen',
      'messageCount',
      'deviceSessions',
      'devices',
      'optedOut',
    ]);
    res
      .set(csvDownloadHeaders(buildFilename(sessionId, month, from, to)))
      .send(csv);
  } catch (err: any) {
    console.error('export chat-numbers.csv failed:', err);
    res.status(500).json({ error: err?.message ?? 'export_failed' });
  }
});

function buildFilename(
  sessionId: string,
  month: string,
  from?: Date,
  to?: Date,
): string {
  const parts: string[] = ['chat-numbers'];
  if (sessionId && sessionId !== 'all') parts.push(sessionId);
  if (month) parts.push(month);
  else if (from || to) {
    const fmt = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '');
    parts.push(`${fmt(from)}_${fmt(to)}`);
  } else {
    parts.push('all-time');
  }
  return `${parts.join('-')}.csv`;
}

function inferCountryForExport(
  message: string | undefined,
  device: string,
): string {
  const haystack = `${message || ''} ${device || ''}`.toLowerCase();
  if (haystack.includes('israel')) return 'Israel';
  if (haystack.includes('singapore')) return 'Singapore';
  if (haystack.includes('japan')) return 'Japan';
  if (haystack.includes('korea')) return 'Korea';
  if (haystack.includes('romania')) return 'Romania';
  return '';
}

/**
 * GET /api/export/phones.csv
 *
 * Single-column-first export of EVERY known mobile number across the
 * tenant — chat history, CRM contacts, leads, AND the LID→phone mapping
 * table. Deduplicated by E.164 digits.
 *
 * Why this exists separately from `/chat-numbers.csv`:
 *   chat-numbers.csv is "one row per conversation". It carries metadata
 *   (lastSeen, messageCount, deviceSession, lastMessage) the operator
 *   needs when triaging the chat list. But if you just want a list of
 *   numbers to import into a dialler / WhatsApp Business broadcast /
 *   marketing tool, you want one number per row with no LID noise and
 *   no rows with empty phone cells.
 *
 * Columns:  phone, name, source
 *   - phone   E.164 with leading + (e.g. +94771234567)
 *   - name    best name across all sources (Contact > Lead > pushName)
 *   - source  one of 'chat' | 'contact' | 'lead' | 'lid-mapping'
 *             ('chat' wins if a phone is in multiple sources — most
 *              actionable signal)
 *
 * Query params:
 *   ?source=chat|contact|lead|lid-mapping  (filter to one source)
 *   ?optedOut=false                         (default true: include all;
 *                                            false drops opted-out)
 */
router.get('/phones.csv', async (req: Request, res: Response) => {
  try {
    const onlySource = req.query.source ? String(req.query.source) : null;
    const dropOptedOut = String(req.query.optedOut ?? 'true') === 'false';
    const tenant = (req as any).tenant;
    const tenantObjectId = tenant?._id
      ? new mongoose.Types.ObjectId(String(tenant._id))
      : null;
    const tenantOrLegacy = tenantObjectId
      ? {
          $or: [{ tenantId: tenantObjectId }, { tenantId: { $exists: false } }],
        }
      : {};

    // Per-phone aggregation: phone → { name, source }. First write wins
    // on `source` because we visit them in priority order (chat is the
    // most actionable signal — they actually messaged the bot).
    const phoneMap = new Map<string, { name: string; source: string }>();
    const optedOut = new Set<string>();

    // 1) Chat: aggregate distinct realPhone from ChatMessage. Same
    //    aggregation shape as /chat-numbers.csv but reduced to phone.
    if (!onlySource || onlySource === 'chat') {
      const chatAgg = (await ChatMessage.aggregate([
        { $match: withTenantScope(req, { role: 'user' }) },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$userId',
            realPhones: { $addToSet: '$metadata.realPhone' },
            pushNames: { $addToSet: '$metadata.pushName' },
          },
        },
        { $limit: MAX_EXPORT_ROWS },
      ])) as Array<{
        _id: string;
        realPhones: (string | null | undefined)[];
        pushNames: (string | null | undefined)[];
      }>;

      for (const row of chatAgg) {
        const phone =
          (row.realPhones || []).find(
            (p): p is string => typeof p === 'string' && p.length > 0,
          ) ?? extractRealPhone(row._id);
        if (!phone) continue;
        const name =
          (row.pushNames || []).find(
            (p): p is string => typeof p === 'string' && p.length > 0,
          ) ?? '';
        if (!phoneMap.has(phone)) {
          phoneMap.set(phone, { name, source: 'chat' });
        }
      }
    }

    // 2) Contacts: every Contact row with a phone-shaped identifier.
    if (!onlySource || onlySource === 'contact') {
      const contacts = (await (Contact as any)
        .find(tenantOrLegacy, {
          name: 1,
          phone: 1,
          whatsappNumber: 1,
          whatsappId: 1,
          optedOut: 1,
        })
        .lean()) as Array<{
        name?: string;
        phone?: string;
        whatsappNumber?: string;
        whatsappId?: string;
        optedOut?: boolean;
      }>;
      for (const c of contacts) {
        const phone = extractRealPhone(
          c.phone || c.whatsappNumber || c.whatsappId || '',
        );
        if (!phone) continue;
        if (c.optedOut) optedOut.add(phone);
        if (!phoneMap.has(phone)) {
          phoneMap.set(phone, { name: c.name ?? '', source: 'contact' });
        }
      }
    }

    // 3) Leads: phoneNumber field; Lead.fullName for the name column.
    if (!onlySource || onlySource === 'lead') {
      const leads = (await Lead.find(tenantOrLegacy, {
        fullName: 1,
        phoneNumber: 1,
      }).lean()) as Array<{ fullName?: string; phoneNumber?: string }>;
      for (const l of leads) {
        const phone = extractRealPhone(l.phoneNumber || '');
        if (!phone) continue;
        if (!phoneMap.has(phone)) {
          phoneMap.set(phone, { name: l.fullName ?? '', source: 'lead' });
        }
      }
    }

    // 4) LID mapping: phones we learned about but who never sent a
    //    ChatMessage that survived (e.g. contacts.upsert hit before any
    //    inbound). No name column for these — the mapping only tracks
    //    LID→phone, not display name.
    if (!onlySource || onlySource === 'lid-mapping') {
      const LidPhoneMapping = (await import('../../models/LidPhoneMapping'))
        .default;
      const mappings = (await LidPhoneMapping.find(
        {},
        { phone: 1 },
      ).lean()) as Array<{ phone?: string }>;
      for (const m of mappings) {
        const phone = extractRealPhone(m.phone || '');
        if (!phone) continue;
        if (!phoneMap.has(phone)) {
          phoneMap.set(phone, { name: '', source: 'lid-mapping' });
        }
      }
    }

    // Materialise: one row per unique phone, dropping opted-out rows
    // when the operator asked for it.
    const rows = Array.from(phoneMap.entries())
      .filter(([phone]) => !dropOptedOut || !optedOut.has(phone))
      .map(([phone, meta]) => ({
        phone: `+${phone}`,
        name: meta.name,
        source: meta.source,
      }))
      // Sort by source priority (chat first) then phone for stable output.
      .sort((a, b) => {
        const order: Record<string, number> = {
          chat: 0,
          contact: 1,
          lead: 2,
          'lid-mapping': 3,
        };
        const so = (order[a.source] ?? 9) - (order[b.source] ?? 9);
        if (so !== 0) return so;
        return a.phone.localeCompare(b.phone);
      });

    const csv = toCsv(rows, ['phone', 'name', 'source']);
    const filename = `phones-${new Date().toISOString().slice(0, 10)}.csv`;
    res.set(csvDownloadHeaders(filename)).send(csv);
  } catch (err: any) {
    console.error('export phones.csv failed:', err);
    res.status(500).json({ error: err?.message ?? 'export_failed' });
  }
});

/**
 * GET /api/export/followups.csv
 *
 * Every Contact with a scheduled follow-up (nextFollowUp set), tenant-scoped
 * the same way /contacts.csv is, sorted by the soonest follow-up first so the
 * operator works the sheet top-to-bottom. Optional ?status=<contact status>
 * narrows to a single CRM status.
 *
 * Columns: Name, Phone, Status, Priority, Next Follow-up, Last Contact, Notes
 * Phone reuses the same real-number resolution as /contacts.csv (metadata
 * realPhone + LID→phone mapping) so LID contacts still export a dialable
 * number.
 */
router.get('/followups.csv', async (req: Request, res: Response) => {
  try {
    const tenant = (req as any).tenant;
    const filter: Record<string, unknown> = {
      nextFollowUp: { $exists: true, $ne: null },
    };
    if (tenant?._id) {
      filter.$or = [
        { tenantId: new mongoose.Types.ObjectId(String(tenant._id)) },
        { tenantId: { $exists: false } },
      ];
    }
    if (req.query.status) filter.status = String(req.query.status);

    const rows = (await (Contact as any)
      .find(filter)
      .sort({ nextFollowUp: 1 })
      .limit(MAX_EXPORT_ROWS)
      .lean()) as any[];

    // Resolve real phones the same way /contacts.csv does so LID contacts
    // still export a dialable number.
    const identifierSet = new Set<string>();
    for (const row of rows) {
      for (const id of contactIdentifierCandidates(row)) identifierSet.add(id);
    }
    const identifiers = Array.from(identifierSet);
    const realPhoneByIdentifier = new Map<string, string>();
    const sessionId =
      typeof req.query.sessionId === 'string' && req.query.sessionId !== 'all'
        ? req.query.sessionId
        : undefined;
    if (identifiers.length > 0) {
      const resolved = (await ChatMessage.aggregate([
        {
          $match: withTenantScope(req, {
            userId: { $in: identifiers },
            'metadata.realPhone': { $exists: true, $ne: '' },
          }),
        },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$userId',
            realPhone: { $first: '$metadata.realPhone' },
          },
        },
      ])) as Array<{ _id: string; realPhone: string }>;
      for (const row of resolved) {
        if (row.realPhone) realPhoneByIdentifier.set(row._id, row.realPhone);
      }

      const mappedPhones = await loadPhoneMapForLids(identifiers, sessionId);
      for (const [lid, phone] of mappedPhones) {
        realPhoneByIdentifier.set(lid, phone);
      }
    }

    const flat = rows.map((r: any) => ({
      Name: r.name ?? '',
      Phone:
        resolveContactExportPhone(r, realPhoneByIdentifier) ||
        r.phone ||
        r.whatsappNumber ||
        '',
      Status: r.status ?? '',
      Priority: r.priority ?? '',
      'Next Follow-up': r.nextFollowUp ?? '',
      'Last Contact': r.lastContact ?? '',
      Notes: r.notes ?? '',
    }));

    const csv = toCsv(flat, [
      'Name',
      'Phone',
      'Status',
      'Priority',
      'Next Follow-up',
      'Last Contact',
      'Notes',
    ]);
    res.set(csvDownloadHeaders('followups.csv')).send(csv);
  } catch (err: any) {
    console.error('export followups.csv failed:', err);
    res.status(500).json({ error: err?.message ?? 'export_failed' });
  }
});

/**
 * GET /api/export/bookings.csv
 *
 * Every Booking, tenant-scoped like the other exports. Optional
 * ?year=YYYY&month=MM (month 1-12) restricts to bookings whose date falls in
 * that calendar month (UTC). Sorted by date ascending.
 *
 * Columns: Name, Phone, Date, Time, Type, Status, Notes
 */
router.get('/bookings.csv', async (req: Request, res: Response) => {
  try {
    const tenant = (req as any).tenant;
    const filter: Record<string, unknown> = {};
    if (tenant?._id) {
      filter.$or = [
        { tenantId: new mongoose.Types.ObjectId(String(tenant._id)) },
        { tenantId: { $exists: false } },
      ];
    }

    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12
    ) {
      filter.date = {
        $gte: new Date(Date.UTC(year, month - 1, 1)),
        $lt: new Date(Date.UTC(year, month, 1)),
      };
    }

    const rows = (await Booking.find(filter)
      .sort({ date: 1 })
      .limit(MAX_EXPORT_ROWS)
      .lean()) as any[];

    const flat = rows.map((r: any) => ({
      Name: r.clientName ?? '',
      Phone: r.clientPhone ?? '',
      Date:
        r.date instanceof Date
          ? r.date.toISOString().slice(0, 10)
          : r.date
            ? new Date(r.date).toISOString().slice(0, 10)
            : '',
      Time: r.time ?? '',
      Type: r.type ?? '',
      Status: r.status ?? '',
      Notes: r.notes ?? '',
    }));

    const csv = toCsv(flat, [
      'Name',
      'Phone',
      'Date',
      'Time',
      'Type',
      'Status',
      'Notes',
    ]);
    res.set(csvDownloadHeaders('bookings.csv')).send(csv);
  } catch (err: any) {
    console.error('export bookings.csv failed:', err);
    res.status(500).json({ error: err?.message ?? 'export_failed' });
  }
});

export default router;
