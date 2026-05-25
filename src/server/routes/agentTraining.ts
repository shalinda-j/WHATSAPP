/**
 * Per-agent training-example routes.
 *
 * Mounted at /api/agent-training to avoid the `/:name` catch-all in
 * routes/agents.ts. All routes are tenant-scoped: an operator only ever
 * sees / mutates training data inside their own tenant.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import AgentTrainingExample from '../../models/AgentTrainingExample';
import { agentRAGService } from '../../services/AgentRAGService';
import { agentRegistry } from '../../agents/AgentRegistry';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — ~20k examples in JSONL
});

const ExampleCreateSchema = z.object({
  input: z.string().min(1).max(8000),
  expectedOutput: z.string().min(1).max(8000),
  tags: z.array(z.string().max(60)).max(20).default([]),
});

function assertAgentExists(agentName: string): boolean {
  return agentRegistry.list().includes(agentName);
}

// ─────────────────────────────────────────────────────────────────────────────
// List + create
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/:agentName/examples',
  async (req: Request<{ agentName: string }>, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });

    const { tag, search, limit = '100' } = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {
      tenantId,
      agentName: req.params.agentName,
    };
    if (tag) filter.tags = tag;
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { input: { $regex: safe, $options: 'i' } },
        { expectedOutput: { $regex: safe, $options: 'i' } },
      ];
    }

    const examples = await AgentTrainingExample.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .lean();

    // Don't ship 1536-float embeddings down the wire; just confirm presence.
    const slim = examples.map((e: any) => ({
      ...e,
      hasEmbedding: Array.isArray(e.embedding) && e.embedding.length > 0,
      embedding: undefined,
    }));

    res.json({
      examples: slim,
      total: slim.length,
      embeddingProviderReady: agentRAGService.isEmbeddingReady(),
    });
  },
);

router.post(
  '/:agentName/examples',
  async (req: Request<{ agentName: string }>, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });
    if (!assertAgentExists(req.params.agentName)) {
      return res.status(404).json({ error: 'agent_not_registered' });
    }

    const parsed = ExampleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const ex = await AgentTrainingExample.create({
      tenantId,
      agentName: req.params.agentName,
      input: parsed.data.input,
      expectedOutput: parsed.data.expectedOutput,
      tags: parsed.data.tags,
      source: 'manual',
    });

    // Fire-and-forget embedding so the POST stays responsive.
    if (agentRAGService.isEmbeddingReady()) {
      agentRAGService.indexExample(String(ex._id)).catch((err) => {
        console.error(`indexExample(${ex._id}) failed:`, err);
      });
    }

    res
      .status(201)
      .json({ example: { ...ex.toObject(), embedding: undefined } });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Bulk JSONL upload
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/:agentName/examples/bulk',
  upload.single('file'),
  async (req: Request<{ agentName: string }>, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });
    if (!assertAgentExists(req.params.agentName)) {
      return res.status(404).json({ error: 'agent_not_registered' });
    }

    const file = (req as Request & { file?: { buffer: Buffer } }).file;
    if (!file?.buffer) return res.status(400).json({ error: 'no_file' });

    const text = file.buffer.toString('utf8');
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsed: Array<{
      input: string;
      expectedOutput: string;
      tags: string[];
    }> = [];
    const errors: Array<{ line: number; reason: string }> = [];

    lines.forEach((line, idx) => {
      try {
        const obj = JSON.parse(line);
        const result = ExampleCreateSchema.safeParse({
          input: obj.input ?? obj.user ?? obj.question ?? '',
          expectedOutput:
            obj.expectedOutput ??
            obj.assistant ??
            obj.answer ??
            obj.response ??
            '',
          tags: Array.isArray(obj.tags) ? obj.tags : [],
        });
        if (!result.success) {
          errors.push({ line: idx + 1, reason: result.error.message });
        } else {
          parsed.push(result.data);
        }
      } catch (err) {
        errors.push({
          line: idx + 1,
          reason: err instanceof Error ? err.message : 'parse_error',
        });
      }
    });

    if (parsed.length === 0) {
      return res.status(400).json({
        error: 'no_valid_rows',
        attempted: lines.length,
        errors: errors.slice(0, 20),
      });
    }

    const created = await AgentTrainingExample.insertMany(
      parsed.map((p) => ({
        tenantId,
        agentName: req.params.agentName,
        input: p.input,
        expectedOutput: p.expectedOutput,
        tags: p.tags,
        source: 'manual',
      })),
    );

    // Kick off embedding for the inserted batch in the background. Caps
    // concurrency at 5 so we don't hammer the embeddings endpoint.
    if (agentRAGService.isEmbeddingReady()) {
      void runWithConcurrency(
        created.map(
          (c) => () =>
            agentRAGService.indexExample(String(c._id)).catch((err) => {
              console.error(`bulk-index ${c._id} failed:`, err);
            }),
        ),
        5,
      );
    }

    res.status(201).json({
      created: created.length,
      attempted: lines.length,
      errors: errors.slice(0, 20),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Re-index (after switching embedding model, or to fill in legacy rows)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/:agentName/examples/reindex',
  async (req: Request<{ agentName: string }>, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });
    if (!agentRAGService.isEmbeddingReady()) {
      return res.status(503).json({
        error: 'embedding_provider_not_configured',
        hint: 'Set OPENAI_API_KEY to enable embedding generation.',
      });
    }

    const candidates = await AgentTrainingExample.find({
      tenantId,
      agentName: req.params.agentName,
      isActive: true,
    })
      .select('_id')
      .lean();

    // Don't block the request on the actual embedding pass — kick it off
    // in the background and report back the queued count.
    void runWithConcurrency(
      candidates.map(
        (c: any) => () =>
          agentRAGService.indexExample(String(c._id)).catch((err) => {
            console.error(`reindex ${c._id} failed:`, err);
          }),
      ),
      5,
    );

    res.json({ queued: candidates.length });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────

router.delete(
  '/:agentName/examples/:id',
  async (req: Request<{ agentName: string; id: string }>, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });

    await AgentTrainingExample.deleteOne({
      _id: req.params.id,
      tenantId,
      agentName: req.params.agentName,
    });
    res.status(204).end();
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Quick retrieval test — useful from the UI to verify what RAG would do
// against a hypothetical user message before promoting a prompt change.
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/:agentName/examples/test-retrieve',
  async (req: Request<{ agentName: string }>, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });

    const query = String(req.body?.query ?? '').slice(0, 4000);
    if (!query) return res.status(400).json({ error: 'missing_query' });

    const retrieved = await agentRAGService.retrieveExamples({
      tenantId: String(tenantId),
      agentName: req.params.agentName,
      query,
      topK: Number(req.body?.topK) || 3,
    });

    res.json({
      retrieved,
      formatted: agentRAGService.formatForPrompt(retrieved),
    });
  },
);

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function runWithConcurrency(
  tasks: Array<() => Promise<unknown>>,
  concurrency: number,
): Promise<void> {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await task();
    }
  });
  await Promise.all(workers);
}
