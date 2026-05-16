import { Router } from 'express';
import { CRMService } from '../../services/CRMService';
import { authenticateToken } from '../middleware/auth';
import { validateObjectId } from '../middleware/validation';
import { resolveTenant } from '../middleware/tenantContext';
import Lead from '../../models/Lead';
import * as path from 'path';
import * as fs from 'fs';
import multer from 'multer';

const router = Router();

// Configure multer for CV uploads
const uploadDir = path.join(__dirname, '../../../uploads/cvs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `cv-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Only PDF, DOC, DOCX, and images are allowed.',
        ),
      );
    }
  },
});

// All CRM routes require authentication AND a resolved tenant.
// The tenant filter is applied at the service / aggregation layer for
// stats endpoints; list endpoints rely on req.tenant being available.
router.use(authenticateToken);
router.use(resolveTenant);

// ==================== DASHBOARD ====================

router.get('/dashboard', async (req, res) => {
  try {
    const stats = await CRMService.getDashboardStats(
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SEARCH ====================

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query is required' });
    }
    // Cap input length so a pathological query string can't be used to
    // burn server CPU even after the regex-injection escape fixed in PR #23.
    if (q.length > 500) {
      return res.status(400).json({ error: 'Search query too long' });
    }
    const results = await CRMService.globalSearch(q);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CONTACTS ====================

router.get('/contacts', async (req, res) => {
  try {
    const { page, limit, search, type, status, source, tags } = req.query;
    const result = await CRMService.getContacts({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search: search as string,
      type: type as string,
      status: status as string,
      source: source as string,
      tags: tags ? (tags as string).split(',') : undefined,
      tenantId: req.tenant?._id ? String(req.tenant._id) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/stats', async (req, res) => {
  try {
    const stats = await CRMService.getContactStats(
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/:id', validateObjectId(), async (req, res) => {
  try {
    const contact = await CRMService.getContactById(
      req.params.id as string,
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(contact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contacts', async (req, res) => {
  try {
    // Stamp the active tenant on insert so subsequent tenant-scoped list
    // queries surface the row. Without this the contact saves but is
    // invisible from the Contacts tab.
    const payload = {
      ...req.body,
      tenantId: req.tenant?._id,
    };
    const contact = await CRMService.createContact(payload);
    res.status(201).json(contact);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/contacts/:id', validateObjectId(), async (req, res) => {
  try {
    // Auto-populate name from firstName/lastName if not provided
    if (!req.body.name && (req.body.firstName || req.body.lastName)) {
      req.body.name = `${req.body.firstName || ''} ${
        req.body.lastName || ''
      }`.trim();
    }
    // Sync whatsappId with whatsappNumber
    if (req.body.whatsappId && !req.body.whatsappNumber) {
      req.body.whatsappNumber = req.body.whatsappId;
    }
    if (req.body.whatsappNumber && !req.body.whatsappId) {
      req.body.whatsappId = req.body.whatsappNumber;
    }

    const contact = await CRMService.updateContact(
      req.params.id as string,
      req.body,
    );
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(contact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH endpoint for partial updates (used by FollowUp page)
router.patch('/contacts/:id', validateObjectId(), async (req, res) => {
  try {
    // Auto-populate name from firstName/lastName if not provided
    if (!req.body.name && (req.body.firstName || req.body.lastName)) {
      req.body.name = `${req.body.firstName || ''} ${
        req.body.lastName || ''
      }`.trim();
    }
    // Sync whatsappId with whatsappNumber
    if (req.body.whatsappId && !req.body.whatsappNumber) {
      req.body.whatsappNumber = req.body.whatsappId;
    }
    if (req.body.whatsappNumber && !req.body.whatsappId) {
      req.body.whatsappId = req.body.whatsappNumber;
    }

    const contact = await CRMService.updateContact(
      req.params.id as string,
      req.body,
    );
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(contact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', validateObjectId(), async (req, res) => {
  try {
    const result = await CRMService.deleteContact(req.params.id as string);
    if (!result) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json({ message: 'Contact deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== DEALS ====================

router.get('/deals', async (req, res) => {
  try {
    const { stage, contact, owner, search, page, limit } = req.query;
    const result = await CRMService.getDeals({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      stage: stage as string,
      contact: contact as string,
      owner: owner as string,
      search: search as string,
      tenantId: req.tenant?._id ? String(req.tenant._id) : undefined,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/deals/kanban', async (req, res) => {
  try {
    const deals = await CRMService.getDealsByStage(
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );
    res.json(deals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals/stats', async (req, res) => {
  try {
    const stats = await CRMService.getDealStats(
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals/:id', validateObjectId(), async (req, res) => {
  try {
    const deal = await CRMService.getDealById(
      req.params.id as string,
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }
    res.json(deal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deals', async (req, res) => {
  try {
    const deal = await CRMService.createDeal({
      ...req.body,
      tenantId: req.tenant?._id,
    });
    res.status(201).json(deal);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/deals/:id', validateObjectId(), async (req, res) => {
  try {
    const deal = await CRMService.updateDeal(req.params.id as string, req.body);
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }
    res.json(deal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/deals/:id', validateObjectId(), async (req, res) => {
  try {
    const result = await CRMService.deleteDeal(req.params.id as string);
    if (!result) {
      return res.status(404).json({ error: 'Deal not found' });
    }
    res.json({ message: 'Deal deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ACTIVITIES ====================

router.get('/activities', async (req, res) => {
  try {
    const { page, limit, type, contact, deal, status, owner, upcoming } =
      req.query;
    const result = await CRMService.getActivities({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      type: type as string,
      contact: contact as string,
      deal: deal as string,
      status: status as string,
      owner: owner as string,
      upcoming: upcoming === 'true',
      tenantId: req.tenant?._id ? String(req.tenant._id) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activities/upcoming', async (req, res) => {
  try {
    const { limit } = req.query;
    const activities = await CRMService.getUpcomingActivities(
      Number(limit) || 10,
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );
    res.json(activities);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activities/:id', validateObjectId(), async (req, res) => {
  try {
    const activity = await CRMService.getActivityById(req.params.id as string);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/activities', async (req, res) => {
  try {
    const activity = await CRMService.createActivity({
      ...req.body,
      tenantId: req.tenant?._id,
    });
    res.status(201).json(activity);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/activities/:id', validateObjectId(), async (req, res) => {
  try {
    const activity = await CRMService.updateActivity(
      req.params.id as string,
      req.body,
    );
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/activities/:id', validateObjectId(), async (req, res) => {
  try {
    const result = await CRMService.deleteActivity(req.params.id as string);
    if (!result) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    res.json({ message: 'Activity deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PIPELINE STAGES ====================

router.get('/pipeline-stages', async (req, res) => {
  try {
    const stages = await CRMService.getPipelineStages();
    res.json(stages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pipeline-stages', async (req, res) => {
  try {
    const stage = await CRMService.createPipelineStage(req.body);
    res.status(201).json(stage);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/pipeline-stages/:id', async (req, res) => {
  try {
    const stage = await CRMService.updatePipelineStage(req.params.id, req.body);
    if (!stage) {
      return res.status(404).json({ error: 'Pipeline stage not found' });
    }
    res.json(stage);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/pipeline-stages/:id', async (req, res) => {
  try {
    const result = await CRMService.deletePipelineStage(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Pipeline stage not found' });
    }
    res.json({ message: 'Pipeline stage deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== REGISTRATIONS (Leads) ====================

// Get all registrations/leads
router.get('/registrations', async (req, res) => {
  try {
    const { page, limit, search, status, country, jobType } = req.query;

    const base: Record<string, unknown> = {};
    if (status) base.status = status;
    if (country) base.interestedCountry = country;
    if (jobType) base.jobVacancyType = jobType;

    // Tenant scope: match this tenant's leads + any legacy leads created
    // before the tenantId field was added. Without the legacy clause the
    // Registrations tab would suddenly empty out post-migration.
    const tenantId = req.tenant?._id ? String(req.tenant._id) : null;
    const tenantClause = tenantId
      ? {
          $or: [{ tenantId }, { tenantId: { $exists: false } }],
        }
      : null;

    let searchClause: Record<string, unknown> | null = null;
    if (search) {
      const escapedSearch = (search as string).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      );
      searchClause = {
        $or: [
          { fullName: { $regex: escapedSearch, $options: 'i' } },
          { phoneNumber: { $regex: escapedSearch, $options: 'i' } },
        ],
      };
    }

    // Combine clauses safely — both tenant filter and search use $or, so
    // a flat merge would clobber one. Wrap in $and when both are present.
    const subClauses = [tenantClause, searchClause].filter(
      (c): c is Record<string, unknown> => c !== null,
    );
    const query: Record<string, unknown> =
      subClauses.length === 0
        ? base
        : subClauses.length === 1
          ? { ...base, ...subClauses[0] }
          : { ...base, $and: subClauses };

    const total = await Lead.countDocuments(query);
    const registrations = await Lead.find(query)
      .sort({ registeredAt: -1 })
      .skip((Number(page || 1) - 1) * Number(limit || 20))
      .limit(Number(limit || 20))
      .lean();

    res.json({
      registrations,
      total,
      page: Number(page || 1),
      totalPages: Math.ceil(total / Number(limit || 20)),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get registration stats
router.get('/registrations/stats', async (req, res) => {
  try {
    // Tenant scope on the count + every aggregation. Legacy leads without
    // a tenantId stay visible to single-tenant deployments via the
    // `$exists: false` branch — matches the list endpoint's behaviour.
    const tenantId = req.tenant?._id ? String(req.tenant._id) : null;
    const tenantScope: Record<string, unknown> = tenantId
      ? { $or: [{ tenantId }, { tenantId: { $exists: false } }] }
      : {};

    const [total, byStatus, byCountry, byJobType, recentCount] =
      await Promise.all([
        Lead.countDocuments(tenantScope),
        Lead.aggregate([
          { $match: tenantScope },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Lead.aggregate([
          { $match: tenantScope },
          { $group: { _id: '$interestedCountry', count: { $sum: 1 } } },
        ]),
        Lead.aggregate([
          { $match: tenantScope },
          { $group: { _id: '$jobVacancyType', count: { $sum: 1 } } },
        ]),
        Lead.countDocuments({
          ...tenantScope,
          registeredAt: {
            $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        }),
      ]);

    res.json({
      total,
      recentCount,
      byStatus: byStatus.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
      byCountry: byCountry.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
      byJobType: byJobType.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single registration
router.get('/registrations/:id', async (req, res) => {
  try {
    const registration = await Lead.findById(req.params.id).lean();
    if (!registration) {
      return res.status(404).json({ error: 'Registration not found' });
    }
    res.json(registration);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update registration status
router.put('/registrations/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const registration = await Lead.findByIdAndUpdate(
      req.params.id,
      { status, notes, updatedAt: new Date() },
      { new: true },
    );
    if (!registration) {
      return res.status(404).json({ error: 'Registration not found' });
    }
    res.json(registration);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Upload CV for registration
router.post('/registrations/:id/cv', upload.single('cv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const registration = await Lead.findById(req.params.id);
    if (!registration) {
      // Delete uploaded file if registration not found
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Registration not found' });
    }

    const cvUrl = `/uploads/cvs/${req.file.filename}`;
    registration.cvUrl = cvUrl;
    registration.cvFileName = req.file.originalname;
    registration.cvUploadedAt = new Date();
    await registration.save();

    res.json({
      success: true,
      cvUrl,
      fileName: req.file.originalname,
      message: 'CV uploaded successfully',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete CV
router.delete('/registrations/:id/cv', async (req, res) => {
  try {
    const registration = await Lead.findById(req.params.id);
    if (!registration) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    // Delete file from disk — strictly inside the CV upload dir.
    // SECURITY: `cvUrl` is stored from earlier uploads but could in theory
    // hold `../`-style traversal if a malicious upsert ever wrote it. We
    // normalise via path.basename + path.resolve, then verify the result
    // still sits inside uploadDir before unlinking.
    if (registration.cvUrl) {
      const safeBasename = path.basename(registration.cvUrl);
      const filePath = path.resolve(uploadDir, safeBasename);
      const inside =
        filePath === path.resolve(uploadDir) ||
        filePath.startsWith(path.resolve(uploadDir) + path.sep);
      if (inside && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    registration.cvUrl = '';
    registration.cvFileName = '';
    registration.cvUploadedAt = undefined;
    await registration.save();

    res.json({ success: true, message: 'CV deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Full registration delete — the frontend's row Delete button was calling
 * DELETE /api/crm/registrations/:id which previously returned 404 because
 * only the /cv variant existed. Tenant-scoped + same path-traversal-safe
 * file cleanup as the /cv handler.
 */
router.delete('/registrations/:id', async (req, res) => {
  try {
    const tenantId = req.tenant?._id ? String(req.tenant._id) : null;
    const query: Record<string, unknown> = { _id: req.params.id };
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: { $exists: false } }];
    }
    const registration = await Lead.findOne(query);
    if (!registration) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    // Clean up any attached CV inside the upload dir (path-traversal safe).
    if (registration.cvUrl) {
      const safeBasename = path.basename(registration.cvUrl);
      const filePath = path.resolve(uploadDir, safeBasename);
      const inside =
        filePath === path.resolve(uploadDir) ||
        filePath.startsWith(path.resolve(uploadDir) + path.sep);
      if (inside && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error('Failed to delete CV during registration delete:', e);
        }
      }
    }

    await registration.deleteOne();
    res.json({ success: true, message: 'Registration deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export registrations to CSV
router.get('/registrations/export', async (req, res) => {
  try {
    const tenantId = req.tenant?._id ? String(req.tenant._id) : null;
    const tenantScope: Record<string, unknown> = tenantId
      ? { $or: [{ tenantId }, { tenantId: { $exists: false } }] }
      : {};
    const registrations = await Lead.find(tenantScope)
      .sort({ registeredAt: -1 })
      .lean();

    if (registrations.length === 0) {
      return res.status(400).json({ error: 'No registrations to export' });
    }

    const headers = [
      'ID',
      'Full Name',
      'Age',
      'Phone',
      'Country',
      'Experience',
      'Job Type',
      'CV',
      'Status',
      'Registered At',
    ];

    const csvRows = registrations.map((r: any) => [
      r._id,
      `"${r.fullName || ''}"`,
      r.age || '',
      `"${r.phoneNumber || ''}"`,
      `"${r.interestedCountry || ''}"`,
      `"${r.experienceYears || ''}"`,
      `"${r.jobVacancyType || ''}"`,
      r.cvUrl ? 'Yes' : 'No',
      `"${r.status || ''}"`,
      new Date(r.registeredAt).toISOString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...csvRows.map((row: string[]) => row.join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="registrations-${
        new Date().toISOString().split('T')[0]
      }.csv"`,
    );
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
