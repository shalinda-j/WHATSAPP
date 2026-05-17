import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Lead from '../../models/Lead';
import { Contact } from '../../models/CRM';
import CampaignExecution from '../../models/CampaignExecution';
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

export default router;
