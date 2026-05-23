import { Router } from 'express';
import multer from 'multer';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdf = require('pdf-parse');
import * as xlsx from 'xlsx';
import Dataset, { DatasetType, Language } from '../../models/Dataset';
import { authenticateToken } from '../middleware/auth';
import {
  resolveTenant,
  withTenantScope,
  tenantIdOf,
} from '../middleware/tenantContext';
import { validateObjectId } from '../middleware/validation';
import { extractTextFromImage } from '../../services/gemini';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Public read (for bot) - though bot likely imports model directly
// Keeping this authenticated for admin panel + tenant-scoped.
router.use(authenticateToken);
router.use(resolveTenant);

// Get all datasets (with optional type filter)
router.get('/', async (req, res) => {
  try {
    const { type, scope, category, key } = req.query;

    // Build filter - always exclude 'config' type (internal configuration items)
    const filter: Record<string, unknown> = {
      type: { $ne: 'config' },
    };

    if (key) {
      filter.key = key;
    }

    if (type) {
      // For specific type filter, override the default
      if (type === 'knowledge') {
        // Knowledge type filter: include documents without type field (legacy) but exclude config
        filter.$or = [
          { type: 'knowledge' },
          { type: { $exists: false } },
          { type: null },
        ];
        delete filter.type; // Remove $ne since $or handles it
        // Add explicit exclusion of config
        filter.$and = [
          {
            $or: [
              { type: 'knowledge' },
              { type: { $exists: false } },
              { type: null },
            ],
          },
          { type: { $ne: 'config' } },
        ];
        delete filter.$or;
      } else {
        // Other types: simple type filter (config is already excluded)
        filter.type = type;
      }
    }
    if (scope) filter.scope = scope;
    if (category) filter.category = category;

    const datasets = await Dataset.find(withTenantScope(req, filter)).sort({
      createdAt: -1,
    });
    res.json(datasets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get datasets by type
router.get('/type/:type', async (req, res) => {
  try {
    const { type } = req.params as { type: DatasetType };
    const validTypes = [
      'knowledge',
      'command',
      'link',
      'marketing',
      'megatext',
      'personality',
    ];

    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid dataset type' });
    }

    // 'config' type is for internal configuration items, not displayed in Datasets page
    const datasets = await Dataset.find(
      withTenantScope(req, { type, isActive: true }),
    ).sort({
      createdAt: -1,
    });
    res.json(datasets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', validateObjectId(), async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) return res.status(404).json({ message: 'Dataset not found' });
    res.json(dataset);
  } catch (err: any) {
    console.error('Error fetching dataset:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Update language-specific content
 */
router.put('/:id/language/:lang', validateObjectId(), async (req, res) => {
  try {
    const { id, lang } = req.params as { id: string; lang: Language };
    const { content } = req.body;

    const validLanguages = ['en', 'si', 'ta'];
    if (!validLanguages.includes(lang)) {
      return res
        .status(400)
        .json({ error: 'Invalid language. Use: en, si, or ta' });
    }

    const updatePath = `content.${lang}`;
    const updatedDataset = await Dataset.findByIdAndUpdate(
      id,
      { $set: { [updatePath]: content } },
      { new: true },
    );

    if (!updatedDataset) {
      return res.status(404).json({ message: 'Dataset not found' });
    }

    res.json(updatedDataset);
  } catch (err: any) {
    console.error('Error updating language content:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Extract text from uploaded file
 */
router.post('/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { mimetype, buffer } = req.file;
    let extractedText = '';

    // 1. PDF Handling
    if (mimetype === 'application/pdf') {
      const data = await pdf(buffer);
      extractedText = data.text;
    }
    // 2. Excel/CSV Handling
    else if (
      mimetype.includes('excel') ||
      mimetype.includes('spreadsheet') ||
      mimetype.includes('csv')
    ) {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // Convert to CSV string for simplicity
      extractedText = xlsx.utils.sheet_to_csv(sheet);
    }
    // 3. Image Handling (OCR)
    else if (mimetype.startsWith('image/')) {
      const base64Data = buffer.toString('base64');
      extractedText = await extractTextFromImage(base64Data, mimetype);
    }
    // 4. Fallback (Text files)
    else if (mimetype.startsWith('text/')) {
      extractedText = buffer.toString('utf-8');
    } else {
      return res.status(400).json({ message: 'Unsupported file type' });
    }

    res.json({ text: extractedText.trim() });
  } catch (err: any) {
    console.error('File extraction error:', err);
    res
      .status(500)
      .json({ error: 'Failed to extract text. ' + (err.message || '') });
  }
});

router.post('/', async (req, res) => {
  try {
    // Strip invalid _id from payload (frontend may send empty string)
    const {
      _id,
      name,
      description,
      type,
      content,
      scope,
      category,
      key,
      isActive,
      metadata,
    } = req.body;

    // Ignore empty or invalid _id values - let MongoDB auto-generate
    if (_id && _id.trim() !== '' && /^[a-fA-F0-9]{24}$/.test(_id)) {
      // Valid ObjectId provided - would be an update case, not create
      return res
        .status(400)
        .json({ error: 'Dataset already exists. Use PUT to update.' });
    }

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Key-based upsert: when the caller supplies a `key` (e.g. AI_PERSONALITY,
    // CONVERSATION_EXAMPLES) and a doc with that key already exists, update it
    // in-place instead of letting the unique index throw E11000. Without this,
    // the frontend can't recover from a stale `_id` in local state.
    if (key && typeof key === 'string' && key.trim() !== '') {
      const existing = await Dataset.findOne({ key });
      if (existing) {
        if (name !== undefined) existing.name = name;
        if (description !== undefined) existing.description = description;
        if (type !== undefined) existing.type = type;
        if (content !== undefined) existing.content = content;
        if (scope !== undefined) existing.scope = scope;
        if (category !== undefined) existing.category = category;
        if (isActive !== undefined) existing.isActive = isActive;
        if (metadata !== undefined) existing.metadata = metadata;
        await existing.save();
        return res.json(existing);
      }
    }

    // Only set `key` when the caller actually provided a non-empty one.
    //
    // Why: the schema declares `key` with `unique: true, sparse: true`.
    // A sparse unique index skips docs where the field is missing/null,
    // but an empty string `''` counts as a value — so writing `key: ''`
    // for every UI-created row makes the FIRST row succeed and every
    // subsequent row fail with E11000. The frontend then shows "Failed
    // to save" and the row never actually lands in Mongo. This is the
    // root cause of "saves in the moment but doesn't persist".
    const datasetPayload: Record<string, unknown> = {
      name,
      description: description || '',
      type: type || 'knowledge',
      content: content || {},
      scope: scope || 'ALL',
      category: category || 'general',
      isActive: isActive !== undefined ? isActive : true,
      metadata: metadata || {},
    };
    if (typeof key === 'string' && key.trim() !== '') {
      datasetPayload.key = key.trim();
    }
    // Stamp the active tenant on creates so the row is owned by them.
    // Reads use withTenantScope to filter, including legacy-row fallback.
    const tid = tenantIdOf(req);
    if (tid) datasetPayload.tenantId = tid;
    const newDataset = new Dataset(datasetPayload);

    await newDataset.save();
    res.json(newDataset);
  } catch (err: any) {
    console.error('Error creating dataset:', {
      message: err.message,
      name: err.name,
      code: err.code,
    });
    // E11000 means a unique-index collision the upsert path above couldn't
    // recover from (e.g. concurrent insert). Surface a readable message so
    // the frontend can act on it.
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'A dataset with the same key already exists. Refresh and retry.',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', validateObjectId(), async (req, res) => {
  try {
    const {
      name,
      description,
      type,
      content,
      scope,
      category,
      key,
      isActive,
      metadata,
    } = req.body;

    console.log('Updating dataset:', {
      id: req.params.id,
      name,
      type,
      contentKeys: content ? Object.keys(content) : [],
    });

    const updateData: Record<string, unknown> = {};
    const unsetData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (type !== undefined) updateData.type = type;
    if (content !== undefined) updateData.content = content;
    if (scope !== undefined) updateData.scope = scope;
    if (category !== undefined) updateData.category = category;
    // Mirror the POST fix: never store `key: ''`. If the client sends an
    // empty string (or whitespace), $unset the field so the sparse unique
    // index continues to treat this row as keyless.
    if (key !== undefined) {
      if (typeof key === 'string' && key.trim() !== '') {
        updateData.key = key.trim();
      } else {
        unsetData.key = '';
      }
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (metadata !== undefined) updateData.metadata = metadata;

    const updateOp: Record<string, unknown> = {};
    if (Object.keys(updateData).length > 0) updateOp.$set = updateData;
    if (Object.keys(unsetData).length > 0) updateOp.$unset = unsetData;

    let updatedDataset = await Dataset.findByIdAndUpdate(
      req.params.id,
      updateOp,
      { new: true },
    );

    // Stale `_id` recovery: if the doc the frontend thought it had has been
    // deleted, fall back to the unique `key` to locate the live record and
    // update that one instead of returning a confusing 404.
    if (!updatedDataset && key && typeof key === 'string' && key.trim() !== '') {
      const byKey = await Dataset.findOne({ key: key.trim() });
      if (byKey) {
        updatedDataset = await Dataset.findByIdAndUpdate(
          byKey._id,
          updateOp,
          { new: true },
        );
      }
    }

    if (!updatedDataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    res.json(updatedDataset);
  } catch (err: any) {
    console.error('Error updating dataset:', {
      message: err.message,
      name: err.name,
      code: err.code,
      id: req.params.id,
    });
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'A dataset with the same key already exists.',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', validateObjectId(), async (req, res) => {
  try {
    const deleted = await Dataset.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Dataset not found' });
    }
    res.json({ message: 'Dataset deleted' });
  } catch (err: any) {
    console.error('Error deleting dataset:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
