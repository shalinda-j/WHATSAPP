import { Router } from 'express';
import FormTemplate, { FormField } from '../../models/FormTemplate';
import FormSubmission from '../../models/FormSubmission';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { standardRateLimit } from '../middleware/rateLimit';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// ============================================
// FORM TEMPLATES
// ============================================

// Get all form templates
router.get('/templates', authenticateToken, resolveTenant, async (req, res) => {
  try {
    const templates = await FormTemplate.find().sort({ createdAt: -1 });
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
      const template = await FormTemplate.findById(req.params.id);
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Get default/active form template (for bot)
// SECURITY FIX: Add rate limiting to prevent abuse
router.get('/default', standardRateLimit, async (req, res) => {
  try {
    let template = await FormTemplate.findOne({
      isActive: true,
      isDefault: true,
    });
    if (!template) {
      template = await FormTemplate.findOne({ isActive: true });
    }
    if (!template) {
      return res.status(404).json({ error: 'No active form template found' });
    }
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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

      // If setting as default, unset other defaults
      if (isDefault) {
        await FormTemplate.updateMany({}, { isDefault: false });
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

      // If setting as default, unset other defaults
      if (isDefault) {
        await FormTemplate.updateMany(
          { _id: { $ne: req.params.id } },
          { isDefault: false },
        );
      }

      const template = await FormTemplate.findByIdAndUpdate(
        req.params.id,
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
      const template = await FormTemplate.findByIdAndDelete(req.params.id);
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
      await FormTemplate.updateMany({}, { isDefault: false });
      const template = await FormTemplate.findByIdAndUpdate(
        req.params.id,
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
      const original = await FormTemplate.findById(req.params.id);
      if (!original) {
        return res.status(404).json({ error: 'Template not found' });
      }

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

      const total = await FormSubmission.countDocuments(query);
      const submissions = await FormSubmission.find(query)
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

    const submission = new FormSubmission({
      formId,
      phoneNumber,
      whatsappJid,
      data,
      status: 'new',
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

      const submission = await FormSubmission.findByIdAndUpdate(
        req.params.id,
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

// Export submissions to CSV
router.get(
  '/submissions/export',
  authenticateToken,
  resolveTenant,
  async (req, res) => {
    try {
      const { formId } = req.query;

      const query: any = {};
      if (formId) query.formId = formId;

      const submissions = await FormSubmission.find(query)
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
      FormTemplate.countDocuments(),
      FormTemplate.countDocuments({ isActive: true }),
      FormSubmission.countDocuments(),
      FormSubmission.aggregate([
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
