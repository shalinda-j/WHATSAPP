import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Lead from '../../models/Lead';
import { authenticateToken } from '../middleware/auth';
import { strictRateLimit } from '../middleware/rateLimit';
import { validateObjectId } from '../middleware/validation';
import { resolveTenant, withTenantScope } from '../middleware/tenantContext';
import pdf from 'pdf-parse';
import ChatMessage from '../../models/ChatMessage';
import { configurationManager } from '../../services/ConfigurationManagerService';
import { agentReflectionService } from '../../services/AgentReflectionService';

const router = Router();

// Resolve the active tenant on every Lead request so list/get/update
// operations naturally scope to the current tenant. Backwards-compatible
// for single-tenant deployments: resolveTenant falls back to the
// auto-created 'default' tenant.
router.use(resolveTenant);

const UPLOAD_DIR = path.join(__dirname, '../../../uploads/qualifications');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images and PDF files are allowed'));
  },
});

// Public route for bot registration (no auth required)
// SECURITY FIX: Add rate limiting to prevent abuse
router.post('/register', strictRateLimit, async (req, res) => {
  try {
    const {
      fullName,
      age,
      phoneNumber,
      address,
      email,
      interestedCountry,
      experienceYears,
      jobVacancyType,
      cvUrl,
    } = req.body;

    if (!fullName || !phoneNumber || !jobVacancyType) {
      return res.status(400).json({
        error: 'Missing required fields: fullName, phoneNumber, jobVacancyType',
      });
    }

    const lead = new Lead({
      fullName,
      age,
      phoneNumber,
      address,
      email,
      interestedCountry,
      experienceYears,
      jobVacancyType,
      cvUrl,
      status: 'new',
      source: 'whatsapp',
      registeredAt: new Date(),
      // Tenant scope — stamp at creation so the lead is visible to the
      // tenant-scoped Registrations list. Falls back to undefined for
      // single-tenant deployments without the resolveTenant middleware,
      // which the list endpoints already handle via the legacy `$exists`
      // backwards-compat clause.
      tenantId: (req as { tenant?: { _id?: unknown } }).tenant?._id,
      // Per-device scope. Bot callers pass `sessionId` in the body
      // (e.g. 'default', 'support-phone'); operators tagging leads
      // from the admin UI may also supply it.
      sessionId:
        typeof (req.body as { sessionId?: unknown })?.sessionId === 'string'
          ? (req.body as { sessionId: string }).sessionId !== 'all'
            ? (req.body as { sessionId: string }).sessionId
            : undefined
          : undefined,
    });

    await lead.save();
    res.status(201).json({ success: true, leadId: lead._id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Apply auth middleware for all other routes
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const {
      status,
      jobVacancyType,
      interestedCountry,
      experienceYears,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const query: any = {};

    if (status) query.status = status;
    if (jobVacancyType) query.jobVacancyType = jobVacancyType;
    if (interestedCountry) query.interestedCountry = interestedCountry;
    if (experienceYears) query.experienceYears = experienceYears;
    if (search) {
      // SECURITY FIX: Escape regex special characters to prevent regex injection
      const escapedSearch = (search as string).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      );
      query.$or = [
        { fullName: { $regex: escapedSearch, $options: 'i' } },
        { phoneNumber: { $regex: escapedSearch, $options: 'i' } },
        { email: { $regex: escapedSearch, $options: 'i' } },
        { interestedCountry: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    // BUGFIX: use the legacy-tolerant tenant scope (matches leads with this
    // tenantId OR no tenantId) instead of a raw `{ tenantId }` equality match.
    // A raw match silently hid every lead captured over WhatsApp whose Session
    // had no tenantId (i.e. the field is absent), so the CRM/Leads list showed
    // 0 even though the leads existed. /stats, /export and /:id already use
    // this pattern — the main list was the odd one out.
    const scopedQuery = withTenantScope(req, query);

    const total = await Lead.countDocuments(scopedQuery);
    // .lean() drops Mongoose's per-doc getters/virtuals/proto chain — fine
    // for a read-only paginated list and noticeably cheaper at high volume.
    const leads = await Lead.find(scopedQuery)
      .sort({ registeredAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    res.json({
      leads,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    // Tenant scope + legacy-doc fallback. Without this every tenant sees
    // the global stats — same leak fixed for /api/crm/registrations/stats.
    const tenantId = (req as { tenant?: { _id?: unknown } }).tenant?._id
      ? String((req as { tenant: { _id: unknown } }).tenant._id)
      : null;
    const tenantScope: Record<string, unknown> = tenantId
      ? { $or: [{ tenantId }, { tenantId: { $exists: false } }] }
      : {};
    const matchStage = tenantId ? [{ $match: tenantScope }] : [];

    const totalLeads = await Lead.countDocuments(tenantScope);
    const byStatus = await Lead.aggregate([
      ...matchStage,
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byJobType = await Lead.aggregate([
      ...matchStage,
      { $group: { _id: '$jobVacancyType', count: { $sum: 1 } } },
    ]);
    const byCountry = await Lead.aggregate([
      ...matchStage,
      { $group: { _id: '$interestedCountry', count: { $sum: 1 } } },
    ]);
    const byExperience = await Lead.aggregate([
      ...matchStage,
      { $group: { _id: '$experienceYears', count: { $sum: 1 } } },
    ]);

    res.json({
      totalLeads,
      byStatus: byStatus.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      byJobType: byJobType.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      byCountry: byCountry.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      byExperience: byExperience.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/job-types', async (req, res) => {
  try {
    const jobTypes = await configurationManager.getJobTypes();
    res.json(jobTypes);
  } catch (error) {
    console.error('Error fetching job types:', error);
    res.json([]);
  }
});

router.get('/export', async (req, res) => {
  try {
    const tenantId = (req as { tenant?: { _id?: unknown } }).tenant?._id
      ? String((req as { tenant: { _id: unknown } }).tenant._id)
      : null;
    const tenantScope: Record<string, unknown> = tenantId
      ? { $or: [{ tenantId }, { tenantId: { $exists: false } }] }
      : {};
    const leads = await Lead.find(tenantScope).sort({ registeredAt: -1 });

    const headers = [
      'ID',
      'Full Name',
      'Age',
      'Phone Number',
      'Email',
      'Address',
      'Interested Country',
      'Experience',
      'Job Vacancy',
      'CV URL',
      'Status',
      'Source',
      'Registration Date',
      'Notes',
    ];

    const csvRows = leads.map((lead: any) => {
      const escapeCsv = (str: string) =>
        `"${(str || '').toString().replace(/"/g, '""')}"`;
      return [
        lead._id,
        escapeCsv(lead.fullName),
        lead.age || '',
        escapeCsv(lead.phoneNumber),
        escapeCsv(lead.email),
        escapeCsv(lead.address),
        escapeCsv(lead.interestedCountry),
        escapeCsv(lead.experienceYears),
        escapeCsv(lead.jobVacancyType),
        escapeCsv(lead.cvUrl),
        escapeCsv(lead.status),
        escapeCsv(lead.source),
        new Date(lead.registeredAt).toISOString(),
        escapeCsv(lead.notes),
      ].join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="leads-export-${
        new Date().toISOString().split('T')[0]
      }.csv"`,
    );
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', validateObjectId(), async (req, res) => {
  try {
    // Tenant-scoped by-id read. withTenantScope falls back to the plain
    // { _id } filter when no tenant is resolved (single-tenant/public),
    // so a cross-tenant id is indistinguishable from a missing one (404).
    const lead = await Lead.findOne(
      withTenantScope(req, { _id: req.params.id }),
    );
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/messages', validateObjectId(), async (req, res) => {
  try {
    const lead = await Lead.findOne(
      withTenantScope(req, { _id: req.params.id }),
    );
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { page = 1, limit = 50 } = req.query;
    const phoneDigits = lead.phoneNumber.replace(/\D/g, '');
    if (!phoneDigits) {
      return res.json({ messages: [], total: 0, page: 1, totalPages: 0 });
    }

    // SECURITY FIX: Escape regex special characters
    const escapedPhone = phoneDigits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Tenant-scope the message lookup (legacy-tolerant) — the lead is already
    // tenant-verified above, but without scoping here two tenants sharing a
    // phone number would leak each other's chat history through this endpoint.
    const query = withTenantScope(req, {
      userId: { $regex: new RegExp(`^${escapedPhone}.*`) },
    });
    const total = await ChatMessage.countDocuments(query);
    const messages = await ChatMessage.find(query)
      .sort({ timestamp: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({
      messages: messages.reverse(),
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    // SECURITY FIX: Validate and sanitize input before creating lead
    const {
      fullName,
      phoneNumber,
      email,
      age,
      address,
      interestedCountry,
      experienceYears,
      jobVacancyType,
      notes,
    } = req.body;

    // Validate required fields
    if (
      !fullName ||
      typeof fullName !== 'string' ||
      fullName.trim().length < 2
    ) {
      return res.status(400).json({
        error: 'fullName must be a non-empty string (min 2 characters)',
      });
    }

    if (
      !phoneNumber ||
      typeof phoneNumber !== 'string' ||
      phoneNumber.trim().length < 5
    ) {
      return res.status(400).json({
        error: 'phoneNumber must be a valid phone number (min 5 characters)',
      });
    }

    // Sanitize and validate optional fields
    const sanitizedData: any = {
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      status: 'new',
      source: 'admin',
      registeredAt: new Date(),
    };

    if (email && typeof email === 'string') {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      sanitizedData.email = email.trim().toLowerCase();
    }

    if (age) {
      const ageNum = parseInt(age);
      if (isNaN(ageNum) || ageNum < 1 || ageNum > 150) {
        return res
          .status(400)
          .json({ error: 'Age must be a valid number between 1 and 150' });
      }
      sanitizedData.age = ageNum;
    }

    if (address && typeof address === 'string') {
      sanitizedData.address = address.trim();
    }

    if (interestedCountry && typeof interestedCountry === 'string') {
      sanitizedData.interestedCountry = interestedCountry.trim();
    }

    if (experienceYears && typeof experienceYears === 'string') {
      sanitizedData.experienceYears = experienceYears.trim();
    }

    if (jobVacancyType && typeof jobVacancyType === 'string') {
      sanitizedData.jobVacancyType = jobVacancyType.trim();
    }

    if (notes && typeof notes === 'string') {
      sanitizedData.notes = notes.trim().substring(0, 1000); // Limit notes length
    }

    const lead = new Lead({
      ...sanitizedData,
      tenantId: (req as { tenant?: { _id?: unknown } }).tenant?._id,
    });
    await lead.save();
    res.status(201).json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', validateObjectId(), async (req, res) => {
  try {
    const query = withTenantScope(req, { _id: req.params.id });
    const previous = await Lead.findOne(query);
    if (!previous) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    // Strip any client-supplied tenantId so a caller can't re-stamp this
    // lead into another tenant via the update body.
    const { tenantId: _ignoredTenantId, ...updateBody } = req.body || {};
    const lead = await Lead.findOneAndUpdate(
      query,
      { ...updateBody, updatedAt: new Date() },
      { new: true },
    );

    // Outcome correlation: when a status moves to a terminal state, push a
    // feedback signal to any agent executions that touched this user in the
    // last 7 days. Fire-and-forget — never block the API response on it.
    if (
      lead &&
      req.body.status &&
      req.body.status !== previous.status &&
      previous.phoneNumber
    ) {
      const jid = `${previous.phoneNumber}@s.whatsapp.net`;
      agentReflectionService
        .correlateLeadOutcome(jid, lead._id, req.body.status)
        .catch((err) => console.error('correlateLeadOutcome failed:', err));
    }

    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', validateObjectId(), async (req, res) => {
  try {
    const lead = await Lead.findOneAndDelete(
      withTenantScope(req, { _id: req.params.id }),
    );
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    for (const qual of lead.qualifications) {
      const filePath = path.join(UPLOAD_DIR, path.basename(qual.filePath));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.json({ message: 'Lead deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  '/:id/qualifications',
  validateObjectId(),
  upload.single('file'),
  async (req, res) => {
    try {
      const lead = await Lead.findOne(
        withTenantScope(req, { _id: req.params.id }),
      );
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      let extractedText = '';
      if (req.file.mimetype === 'application/pdf') {
        try {
          const dataBuffer = fs.readFileSync(req.file.path);
          const data = await pdf(dataBuffer);
          extractedText = data.text;
        } catch (pdfErr) {
          console.error('PDF parsing error:', pdfErr);
        }
      }

      const qualification: any = {
        documentType: req.body.documentType || 'other',
        fileName: req.file.originalname,
        filePath: `/uploads/qualifications/${req.file.filename}`,
        fileSize: req.file.size,
        extractedText,
        uploadedAt: new Date(),
      };

      const leadDoc = lead as any;
      if (!leadDoc.qualifications) {
        leadDoc.qualifications = [];
      }
      leadDoc.qualifications.push(qualification);
      leadDoc.updatedAt = new Date();
      await lead.save();

      res.json(lead);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

router.get('/:id/qualifications/:qualIndex/download', async (req, res) => {
  try {
    const lead = await Lead.findOne(
      withTenantScope(req, { _id: req.params.id }),
    );
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const qualIndex = parseInt(req.params.qualIndex);
    if (
      isNaN(qualIndex) ||
      qualIndex < 0 ||
      qualIndex >= lead.qualifications.length
    ) {
      return res.status(404).json({ error: 'Qualification not found' });
    }

    const qual = lead.qualifications[qualIndex];
    const filePath = path.join(UPLOAD_DIR, path.basename(qual.filePath));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, qual.fileName);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
