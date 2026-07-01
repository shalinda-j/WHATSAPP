import { Router } from 'express';
import { knowledgeTrainingService } from '../../services/KnowledgeTrainingService';
import KnowledgeEntry from '../../models/KnowledgeEntry';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant, withTenantScope } from '../middleware/tenantContext';

const router = Router();

// All routes require authentication + tenant context
router.use(authenticateToken);
router.use(resolveTenant);

/**
 * GET /api/knowledge
 * Get all knowledge entries
 */
router.get('/', async (req, res) => {
  try {
    const { category, source, language, active, search } = req.query;

    const query: Record<string, unknown> = {};

    if (category) query.category = category;
    if (source) query.source = source;
    if (language) query.language = language;
    if (active !== undefined) query.isActive = active === 'true';

    // Tenant-scope reads (with legacy-row fallback).
    const scoped = withTenantScope(req, query);

    let entries;
    if (search) {
      // Text search — keep textScore projection; merge tenant scope into the
      // $text-anchored find so cross-tenant rows can't leak through.
      entries = await KnowledgeEntry.find(
        { ...scoped, $text: { $search: search as string } },
        { score: { $meta: 'textScore' } },
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(50)
        .lean(); // ⚡ Bolt: Use .lean() to bypass document hydration
    } else {
      entries = await KnowledgeEntry.find(scoped)
        .sort({ usageCount: -1, createdAt: -1 })
        .limit(100)
        .lean(); // ⚡ Bolt: Use .lean() to bypass document hydration
    }

    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/knowledge/stats
 * Get training statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await knowledgeTrainingService.getStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/knowledge/:id
 * Get single knowledge entry
 */
router.get('/:id', async (req, res) => {
  try {
    const entry = await KnowledgeEntry.findOne(
      withTenantScope(req, { _id: req.params.id }),
    ).lean(); // ⚡ Bolt: Use .lean() to bypass document hydration
    if (!entry) {
      return res.status(404).json({ message: 'Knowledge entry not found' });
    }
    res.json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/knowledge
 * Add new knowledge entry
 */
router.post('/', async (req, res) => {
  try {
    const { question, answer, category, tags, language } = req.body;

    if (!question || !answer) {
      return res
        .status(400)
        .json({ message: 'Question and answer are required' });
    }

    const entry = await knowledgeTrainingService.addKnowledge(
      question,
      answer,
      category || 'general',
      tags || [],
      language || 'all',
    );

    res.json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/knowledge/batch
 * Add multiple knowledge entries
 */
router.post('/batch', async (req, res) => {
  try {
    const { entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: 'Entries array is required' });
    }

    const created = [];
    for (const entry of entries) {
      if (entry.question && entry.answer) {
        const newEntry = await knowledgeTrainingService.addKnowledge(
          entry.question,
          entry.answer,
          entry.category || 'general',
          entry.tags || [],
          entry.language || 'all',
        );
        created.push(newEntry);
      }
    }

    res.json({ created: created.length, entries: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/knowledge/:id
 * Update knowledge entry
 */
router.put('/:id', async (req, res) => {
  try {
    const { question, answer, category, tags, language, isActive, confidence } =
      req.body;

    const updates: any = {};
    if (question !== undefined) updates.question = question;
    if (answer !== undefined) updates.answer = answer;
    if (category !== undefined) updates.category = category;
    if (tags !== undefined) updates.tags = tags;
    if (language !== undefined) updates.language = language;
    if (isActive !== undefined) updates.isActive = isActive;
    if (confidence !== undefined) updates.confidence = confidence;

    const entry = await knowledgeTrainingService.updateKnowledge(
      req.params.id,
      updates,
    );

    if (!entry) {
      return res.status(404).json({ message: 'Knowledge entry not found' });
    }

    res.json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/knowledge/:id
 * Delete knowledge entry
 */
router.delete('/:id', async (req, res) => {
  try {
    const success = await knowledgeTrainingService.deleteKnowledge(
      req.params.id,
    );

    if (!success) {
      return res.status(404).json({ message: 'Knowledge entry not found' });
    }

    res.json({ message: 'Knowledge entry deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/knowledge/search
 * Search knowledge base
 */
router.post('/search', async (req, res) => {
  try {
    const { query, limit } = req.body;

    if (!query) {
      return res.status(400).json({ message: 'Query is required' });
    }

    const results = await knowledgeTrainingService.searchKnowledge(
      query,
      limit || 5,
    );
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/knowledge/import/:datasetKey
 * Import knowledge from dataset
 */
router.post('/import/:datasetKey', async (req, res) => {
  try {
    const count = await knowledgeTrainingService.importFromDataset(
      req.params.datasetKey,
    );
    res.json({ imported: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/knowledge/sync
 * Sync knowledge base with AI
 */
router.post('/sync', async (req, res) => {
  try {
    await knowledgeTrainingService.syncWithAI();
    res.json({ message: 'Knowledge base synced with AI' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/knowledge/export/kb
 * Get formatted knowledge base for AI
 */
router.get('/export/kb', async (req, res) => {
  try {
    const { category } = req.query;
    const kb = await knowledgeTrainingService.getKnowledgeBaseForAI(
      category as string,
    );
    res.json({ knowledgeBase: kb });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
