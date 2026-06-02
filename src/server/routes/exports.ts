import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Lead from '../../models/Lead';
import { Contact } from '../../models/CRM';
import CampaignExecution from '../../models/CampaignExecution';
import ChatMessage from '../../models/ChatMessage';
import { toCsv, csvDownloadHeaders } from '../utils/csv';
import { extractRealPhone, isLidJid } from '../../utils/jid';
import {
  loadPhoneMapForLids,
  normaliseLidJid,
} from '../../services/LidPhoneMappingService';
import Session from '../../models/Session';

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
      (bareDigits ? realPhoneByIdentifier.get(bareDigits) : undefined);
    if (phone) return formatExportPhone(phone);
  }

  return '';
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

router.get('/contacts.csv', async (req: Request, res: Response) => {
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
    if (req.query.type) filter.type = String(req.query.type);

    const rows = (await (Contact as any)
      .find(filter)
      .sort({ updatedAt: -1 })
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
          $match: {
            userId: { $in: identifiers },
            'metadata.realPhone': { $exists: true, $ne: '' },
          },
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
          `crm-contacts-${new Date().toISOString().slice(0, 10)}.csv`,
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
      { $match: match },
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
        { $match: { role: 'user' } },
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

export default router;
