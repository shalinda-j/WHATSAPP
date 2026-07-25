import { Router } from 'express';
import FormTemplate, { FormField } from '../../models/FormTemplate';
import FormSubmission from '../../models/FormSubmission';
import { authenticateToken } from '../middleware/auth';
import {
  resolveTenant,
  withTenantScope,
  tenantIdOf,
} from '../middleware/tenantContext';
import { standardRateLimit } from '../middleware/rateLimit';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// ============================================
// FORM TEMPLATES
// ============================================

// Get all form templates
router.get('/templates', authenticateToken, resolveTenant, async (req, res) => {
  try {
    const templates = await FormTemplate.find(withTenantScope(req, {})).sort({
      createdAt: -1,
    });
    res.json(templates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single form template
router.get(
  '/templates/:id',
  authenticateToken,
  resolveTenant,
  validateObjectId(),
  async (req, res) => {
    try {
      const template = await FormTemplate.findOne(
        withTenantScope(req, { _id: req.params.id }),
      );
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Get default/active form template (for bot). PUBLIC — no auth (the bot has
// no admin token). Exported so app.ts can mount it BEFORE the authenticated
// `/api/forms` router; mounting it only inside this router doesn't help
// because the parent `app.use('/api/forms', authenticateToken, ...)` prefix
// match forces auth onto every path including /default.
export async function defaultFormHandler(
  _req: import('express').Request,
  res: import('express').Response,
): Promise<void> {
  try {
    let template = await FormTemplate.findOne({
      isActive: true,
      isDefault: true,
    });
    if (!template) {
      template = await FormTemplate.findOne({ isActive: true });
    }
    if (!template) {
      res.status(404).json({ error: 'No active form template found' });
      return;
    }
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// Kept for direct hits on the authenticated router too (harmless duplicate).
router.get('/default', standardRateLimit, defaultFormHandler);

// Create form template
router.post(
  '/templates',
  authenticateToken,
  resolveTenant,
  async (req, res) => {
    try {
      const {
        name,
        description,
        fields,
        triggerMode,
        triggerDelay,
        welcomeMessage,
        completionMessage,
        isDefault,
      } = req.body;

      const tid = tenantIdOf(req);
      // If setting as default, unset other defaults — scoped to THIS
      // tenant only, otherwise one tenant's default could clobber another's.
      if (isDefault) {
        await FormTemplate.updateMany(tid ? { tenantId: tid } : {}, {
          isDefault: false,
        });
      }

      const template = new FormTemplate({
        name,
        description,
        fields: fields || [],
        triggerMode: triggerMode || 'both',
        triggerDelay: triggerDelay || 10,
        welcomeMessage,
        completionMessage,
        isDefault: isDefault || false,
        isActive: true,
        ...(tid ? { tenantId: tid } : {}),
      });

      await template.save();
      res.status(201).json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Update form template
router.put(
  '/templates/:id',
  authenticateToken,
  resolveTenant,
  validateObjectId(),
  async (req, res) => {
    try {
      const {
        name,
        description,
        fields,
        triggerMode,
        triggerDelay,
        welcomeMessage,
        completionMessage,
        isActive,
        isDefault,
      } = req.body;

      // If setting as default, unset other defaults — scoped to THIS tenant
      // only, otherwise one tenant's default could clobber another's.
      const tid = tenantIdOf(req);
      if (isDefault) {
        await FormTemplate.updateMany(
          {
            _id: { $ne: req.params.id },
            ...(tid ? { tenantId: tid } : {}),
          },
          { isDefault: false },
        );
      }

      // Tenant-scope the by-id mutation so an operator can't edit another
      // tenant's template. Legacy null/undefined rows stay editable; a
      // cross-tenant id 404s indistinguishably from a missing one.
      const template = await FormTemplate.findOneAndUpdate(
        withTenantScope(req, { _id: req.params.id }),
        {
          name,
          description,
          fields,
          triggerMode,
          triggerDelay,
          welcomeMessage,
          completionMessage,
          isActive,
          isDefault,
          updatedAt: new Date(),
        },
        { new: true },
      );

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Delete form template
router.delete(
  '/templates/:id',
  authenticateToken,
  resolveTenant,
  validateObjectId(),
  async (req, res) => {
    try {
      // Tenant-scope the delete so a tenant admin can't delete another
      // tenant's template by id.
      const template = await FormTemplate.findOneAndDelete(
        withTenantScope(req, { _id: req.params.id }),
      );
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      res.json({ message: 'Template deleted successfully' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Set template as default
router.post(
  '/templates/:id/set-default',
  authenticateToken,
  resolveTenant,
  validateObjectId(),
  async (req, res) => {
    try {
      // Scope the clear-defaults to THIS tenant only, otherwise setting a
      // default for one tenant would clear every other tenant's default too.
      const tid = tenantIdOf(req);
      await FormTemplate.updateMany(tid ? { tenantId: tid } : {}, {
        isDefault: false,
      });
      // Tenant-scope the by-id promotion so a tenant admin can't hijack
      // another tenant's default form (the public /default handler serves
      // whatever is flagged isDefault).
      const template = await FormTemplate.findOneAndUpdate(
        withTenantScope(req, { _id: req.params.id }),
        { isDefault: true, updatedAt: new Date() },
        { new: true },
      );
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Duplicate template
router.post(
  '/templates/:id/duplicate',
  authenticateToken,
  resolveTenant,
  validateObjectId(),
  async (req, res) => {
    try {
      // Tenant-scope the source read so a tenant admin can't clone another
      // tenant's template.
      const original = await FormTemplate.findOne(
        withTenantScope(req, { _id: req.params.id }),
      );
      if (!original) {
        return res.status(404).json({ error: 'Template not found' });
      }

      // Stamp the copy with the caller's tenant (matches POST /templates).
      const tid = tenantIdOf(req);
      const duplicate = new FormTemplate({
        name: `${original.name} (Copy)`,
        description: original.description,
        fields: original.fields,
        triggerMode: original.triggerMode,
        triggerDelay: original.triggerDelay,
        welcomeMessage: original.welcomeMessage,
        completionMessage: original.completionMessage,
        isDefault: false,
        isActive: true,
        ...(tid ? { tenantId: tid } : {}),
      });

      await duplicate.save();
      res.status(201).json(duplicate);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ============================================
// FORM SUBMISSIONS
// ============================================

// Get submissions with filtering
router.get(
  '/submissions',
  authenticateToken,
  resolveTenant,
  async (req, res) => {
    try {
      const { formId, status, search, page = 1, limit = 20 } = req.query;

      const query: any = {};
      if (formId) query.formId = formId;
      if (status) query.status = status;
      if (search) {
        // SECURITY FIX: Escape regex to prevent injection
        const escapedSearch = (search as string).replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        query.phoneNumber = { $regex: escapedSearch, $options: 'i' };
      }

      const scopedQuery = withTenantScope(req, query);
      const total = await FormSubmission.countDocuments(scopedQuery);
      const submissions = await FormSubmission.find(scopedQuery)
        .sort({ submittedAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .populate('formId', 'name')
        .lean();

      // Convert Map to object for JSON serialization
      const processedSubmissions = submissions.map((s: any) => ({
        ...s,
        data: s.data instanceof Map ? Object.fromEntries(s.data) : s.data,
      }));

      res.json({
        submissions: processedSubmissions,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Export submissions to CSV
// NOTE: must be registered BEFORE the '/submissions/:id' param route below —
// Express matches in registration order, and a '/submissions/:id' declared
// first captures the literal path "/submissions/export" as id="export",
// which validateObjectId() then rejects with HTTP 400 (export never runs).
router.get(
  '/submissions/export',
  authenticateToken,
  resolveTenant,
  async (req, res) => {
    try {
      const { formId } = req.query;

      const query: any = {};
      if (formId) query.formId = formId;

      const submissions = await FormSubmission.find(withTenantScope(req, query))
        .sort({ submittedAt: -1 })
        .populate('formId', 'name fields')
        .lean();

      if (submissions.length === 0) {
        return res.status(400).json({ error: 'No submissions to export' });
      }

      // Get all field labels from the first form
      const form = submissions[0].formId as any;
      const fieldLabels = form?.fields?.map((f: FormField) => f.label) || [];

      const headers = ['ID', 'Phone', 'Status', 'Submitted At', ...fieldLabels];

      const csvRows = submissions.map((s: any) => {
        const data =
          s.data instanceof Map ? Object.fromEntries(s.data) : s.data;
        const values =
          form?.fields?.map((f: FormField) => {
            const val = data?.[f.id];
            return `"${(val || '').toString().replace(/"/g, '""')}"`;
          }) || [];

        return [
          s._id,
          `"${s.phoneNumber}"`,
          `"${s.status}"`,
          new Date(s.submittedAt).toISOString(),
          ...values,
        ].join(',');
      });

      const csvContent = [headers.join(','), ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="form-submissions-${
          new Date().toISOString().split('T')[0]
        }.csv"`,
      );
      res.send(csvContent);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Get single submission
router.get(
  '/submissions/:id',
  authenticateToken,
  resolveTenant,
  validateObjectId(),
  async (req, res) => {
    try {
      const submission = await FormSubmission.findById(req.params.id)
        .populate('formId', 'name fields')
        .lean();

      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      // Tenant isolation: a submission belonging to another tenant must be
      // indistinguishable from a missing one (no cross-tenant existence
      // oracle). Legacy rows with null/undefined tenantId stay accessible.
      const reqTid = tenantIdOf(req);
      if (
        reqTid &&
        (submission as any).tenantId &&
        String((submission as any).tenantId) !== String(reqTid)
      ) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      // Convert Map to object
      res.json({
        ...submission,
        data:
          submission.data instanceof Map
            ? Object.fromEntries(submission.data)
            : submission.data,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Create submission (from WhatsApp bot - no auth)
// SECURITY FIX: Add rate limiting to prevent abuse
router.post('/submissions', standardRateLimit, async (req, res) => {
  try {
    const { formId, phoneNumber, whatsappJid, data } = req.body;

    // Inherit the tenant of the form template so bot/public submissions are
    // attributed to the right tenant (this route has no resolved tenant).
    const tpl = await FormTemplate.findById(formId).select('tenantId').lean();

    const submission = new FormSubmission({
      formId,
      phoneNumber,
      whatsappJid,
      data,
      status: 'new',
      ...((tpl as any)?.tenantId ? { tenantId: (tpl as any).tenantId } : {}),
    });

    await submission.save();
    res.status(201).json({ success: true, submissionId: submission._id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update submission status
router.put(
  '/submissions/:id/status',
  authenticateToken,
  resolveTenant,
  validateObjectId(),
  async (req, res) => {
    try {
      const { status, notes } = req.body;

      // Tenant-scope the by-id mutation so an operator can't flip the status
      // of another tenant's submission. Legacy null/undefined rows stay
      // editable; a cross-tenant id 404s indistinguishably from a missing one.
      const tid = tenantIdOf(req);
      const filter: any = tid
        ? {
            _id: req.params.id,
            $or: [
              { tenantId: tid },
              { tenantId: { $exists: false } },
              { tenantId: null },
            ],
          }
        : { _id: req.params.id };

      const submission = await FormSubmission.findOneAndUpdate(
        filter,
        {
          status,
          notes,
          reviewedAt: status !== 'new' ? new Date() : undefined,
          updatedAt: new Date(),
        },
        { new: true },
      );

      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }
      res.json(submission);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ============================================
// STATISTICS
// ============================================

router.get('/stats', authenticateToken, resolveTenant, async (req, res) => {
  try {
    const [
      totalTemplates,
      activeTemplates,
      totalSubmissions,
      submissionsByStatus,
    ] = await Promise.all([
      FormTemplate.countDocuments(withTenantScope(req, {})),
      FormTemplate.countDocuments(withTenantScope(req, { isActive: true })),
      FormSubmission.countDocuments(withTenantScope(req, {})),
      FormSubmission.aggregate([
        { $match: withTenantScope(req, {}) },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      totalTemplates,
      activeTemplates,
      totalSubmissions,
      submissionsByStatus: submissionsByStatus.reduce(
        (acc: Record<string, number>, item: any) => {
          acc[item._id] = item.count;
          return acc;
        },
        {},
      ),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
