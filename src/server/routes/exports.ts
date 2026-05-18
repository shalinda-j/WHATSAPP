import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Lead from '../../models/Lead';
import { Contact } from '../../models/CRM';
import CampaignExecution from '../../models/CampaignExecution';
import ChatMessage from '../../models/ChatMessage';
import { toCsv, csvDownloadHeaders } from '../utils/csv';

const router = express.Router();

const MAX_EXPORT_ROWS = 50_000;

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
      .set(csvDownloadHeaders(`leads-${new Date().toISOString().slice(0, 10)}.csv`))
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

    const flat = rows.map((r: any) => ({
      id: String(r._id),
      name: r.name,
      email: r.email ?? '',
      phone: r.phone ?? r.whatsappNumber ?? '',
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

    const match: Record<string, unknown> = { role: 'user' };
    if (sessionId && sessionId !== 'all') {
      match['metadata.sessionId'] = sessionId;
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
    };

    const agg = (await ChatMessage.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$userId',
          messageCount: { $sum: 1 },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' },
          sessionIds: { $addToSet: '$metadata.sessionId' },
        },
      },
      { $sort: { lastSeen: -1 } },
      { $limit: MAX_EXPORT_ROWS },
    ])) as Agg[];

    if (agg.length === 0) {
      const empty = toCsv([], [
        'phone',
        'name',
        'email',
        'lastSeen',
        'firstSeen',
        'messageCount',
        'deviceSessions',
        'optedOut',
      ]);
      res
        .set(csvDownloadHeaders(buildFilename(sessionId, month, from, to)))
        .send(empty);
      return;
    }

    // userId is the WhatsApp JID — strip the suffix to get raw digits.
    // Some legacy rows used the raw phone, others used JIDs; handle both.
    const toDigits = (jid: string): string => {
      if (!jid) return '';
      const at = jid.indexOf('@');
      return (at >= 0 ? jid.slice(0, at) : jid).replace(/\D/g, '');
    };

    const phoneByUserId = new Map<string, string>(
      agg.map((row) => [row._id, toDigits(row._id)]),
    );
    const distinctDigits = Array.from(
      new Set(Array.from(phoneByUserId.values()).filter(Boolean)),
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

    const rows = agg.map((r) => {
      const phone = phoneByUserId.get(r._id) || '';
      const contact = phone ? contactsByPhone.get(phone) : undefined;
      return {
        phone,
        name: contact?.name ?? '',
        email: contact?.email ?? '',
        lastSeen: r.lastSeen,
        firstSeen: r.firstSeen,
        messageCount: r.messageCount,
        deviceSessions: (r.sessionIds || [])
          .filter((s): s is string => Boolean(s))
          .join(';'),
        optedOut: contact?.optedOut ? 'true' : '',
      };
    });

    const csv = toCsv(rows, [
      'phone',
      'name',
      'email',
      'lastSeen',
      'firstSeen',
      'messageCount',
      'deviceSessions',
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

export default router;