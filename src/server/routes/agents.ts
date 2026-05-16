import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import AgentConfig from '../../models/AgentConfig';
import AgentPromptVersion from '../../models/AgentPromptVersion';
import AgentExecution from '../../models/AgentExecution';
import AgentFeedback from '../../models/AgentFeedback';
import { agentApprovalQueueService } from '../../services/AgentApprovalQueueService';
import { agentBudgetService } from '../../services/AgentBudgetService';
import { agentRegistry } from '../../agents/AgentRegistry';
import { agentReflectionService } from '../../services/AgentReflectionService';
import { AgentModeSchema } from '../../types/agent';

const router = Router();
router.use(authenticateToken);

const ConfigPatchSchema = z.object({
  description: z.string().optional(),
  mode: AgentModeSchema.optional(),
  modelOverride: z.string().nullable().optional(),
  providerOverride: z.string().nullable().optional(),
  budgetTokensPerConversation: z.number().int().min(0).optional(),
  budgetTokensPerDay: z.number().int().min(0).optional(),
  costCapUsdPerDay: z.number().min(0).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  maxStepsPerMessage: z.number().int().min(1).max(5).optional(),
  isActive: z.boolean().optional(),
  promotionPolicy: z.enum(['auto', 'manual']).optional(),
  autoPromoteMinSamples: z.number().int().min(1).optional(),
  autoPromoteMinPValue: z.number().min(0).max(1).optional(),
  candidateTrafficPercent: z.number().min(0).max(50).optional(),
});

const PromptCreateSchema = z.object({
  systemPrompt: z.string().min(1),
  changelog: z.string().default(''),
  toolSchemaJson: z.string().nullable().optional(),
  makeCandidate: z.boolean().default(true),
});

// Safety cap on candidate traffic — a runaway candidate at >50% defeats the
// point of an A/B test. Operators who genuinely want a full canary should
// promote() instead of cranking traffic.
const MAX_CANDIDATE_TRAFFIC_PERCENT = 50;

const PromptPatchSchema = z.object({
  action: z.enum(['promote', 'archive', 'set_candidate', 'clear_candidate']),
  trafficPercent: z
    .number()
    .min(0)
    .max(MAX_CANDIDATE_TRAFFIC_PERCENT)
    .optional(),
});

const TrafficUpdateSchema = z.object({
  trafficPercent: z.number().min(0).max(MAX_CANDIDATE_TRAFFIC_PERCENT),
});

const FeedbackCreateSchema = z.object({
  executionId: z.string(),
  score: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  note: z.string().nullable().optional(),
});

function adminUser(req: Request): string {
  return (req as any).user?.userId || (req as any).user?.username || 'admin';
}

function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error('🔥 /api/agents error:', err);
      const msg = err instanceof Error ? err.message : 'Internal error';
      const status = /not found/i.test(msg) ? 404 : 500;
      res.status(status).json({ success: false, error: msg });
    });
  };
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const configs = await AgentConfig.find().sort({ name: 1 });
    const today = await Promise.all(
      configs.map((c) => agentBudgetService.todayStats(c.name)),
    );
    const pendingCount = await agentApprovalQueueService.pendingCount();
    res.json({
      success: true,
      agents: configs.map((c, i) => ({
        ...c.toObject(),
        todayUsage: today[i],
        registered: agentRegistry.list().includes(c.name),
      })),
      registeredNotConfigured: agentRegistry
        .list()
        .filter((n) => !configs.some((c) => c.name === n)),
      pendingApprovals: pendingCount,
    });
  }),
);

router.get(
  '/:name',
  asyncHandler(async (req, res) => {
    const config = await AgentConfig.findOne({ name: String(req.params.name) });
    if (!config) throw new Error('Agent not found');
    const [versions, recentExecutions, todayStats] = await Promise.all([
      AgentPromptVersion.find({ agentName: String(req.params.name) })
        .sort({ version: -1 })
        .limit(20),
      AgentExecution.find({ agentName: String(req.params.name) })
        .sort({ createdAt: -1 })
        .limit(20),
      agentBudgetService.todayStats(String(req.params.name)),
    ]);
    res.json({
      success: true,
      config,
      versions,
      recentExecutions,
      todayStats,
    });
  }),
);

router.patch(
  '/:name',
  asyncHandler(async (req, res) => {
    const patch = ConfigPatchSchema.parse(req.body);
    const updated = await AgentConfig.findOneAndUpdate(
      { name: String(req.params.name) },
      { $set: patch },
      { new: true },
    );
    if (!updated) throw new Error('Agent not found');
    await agentRegistry.forceReload();
    res.json({ success: true, config: updated });
  }),
);

router.get(
  '/:name/versions',
  asyncHandler(async (req, res) => {
    const versions = await AgentPromptVersion.find({
      agentName: String(req.params.name),
    }).sort({ version: -1 });
    res.json({ success: true, versions });
  }),
);

router.post(
  '/:name/versions',
  asyncHandler(async (req, res) => {
    const body = PromptCreateSchema.parse(req.body);
    const last = await AgentPromptVersion.findOne({
      agentName: String(req.params.name),
    }).sort({ version: -1 });
    const nextVersion = (last?.version ?? 0) + 1;
    const created = await AgentPromptVersion.create({
      agentName: String(req.params.name),
      version: nextVersion,
      systemPrompt: body.systemPrompt,
      changelog: body.changelog,
      toolSchemaJson: body.toolSchemaJson ?? null,
      createdBy: adminUser(req),
      isCurrent: false,
      isCandidate: body.makeCandidate,
    });
    if (body.makeCandidate) {
      await AgentConfig.updateOne(
        { name: String(req.params.name) },
        { $set: { candidatePromptVersion: nextVersion } },
      );
    }
    res.json({ success: true, version: created });
  }),
);

router.patch(
  '/:name/versions/:v',
  asyncHandler(async (req, res) => {
    const body = PromptPatchSchema.parse(req.body);
    const v = Number(String(req.params.v));
    const name = String(req.params.name);

    if (body.action === 'promote') {
      const config = await AgentConfig.findOne({ name });
      if (!config) throw new Error('Agent not found');
      await agentReflectionService.promote(
        name,
        v,
        config.currentPromptVersion,
      );
      const updated = await AgentConfig.findOne({ name });
      res.json({ success: true, config: updated });
      return;
    }

    if (body.action === 'archive') {
      await AgentPromptVersion.updateOne(
        { agentName: name, version: v },
        { $set: { archivedAt: new Date(), isCandidate: false } },
      );
      await AgentConfig.updateOne(
        { name, candidatePromptVersion: v },
        { $set: { candidatePromptVersion: null } },
      );
      res.json({ success: true });
      return;
    }

    if (body.action === 'set_candidate') {
      await AgentPromptVersion.updateMany(
        { agentName: name, isCandidate: true },
        { $set: { isCandidate: false } },
      );
      await AgentPromptVersion.updateOne(
        { agentName: name, version: v },
        { $set: { isCandidate: true } },
      );
      const update: Record<string, unknown> = {
        candidatePromptVersion: v,
      };
      if (body.trafficPercent != null) {
        update.candidateTrafficPercent = body.trafficPercent;
      }
      await AgentConfig.updateOne({ name }, { $set: update });
      res.json({ success: true });
      return;
    }

    if (body.action === 'clear_candidate') {
      await AgentPromptVersion.updateMany(
        { agentName: name, isCandidate: true },
        { $set: { isCandidate: false } },
      );
      await AgentConfig.updateOne(
        { name },
        { $set: { candidatePromptVersion: null } },
      );
      res.json({ success: true });
      return;
    }
  }),
);

/**
 * Adjust the traffic split for whichever version is currently the candidate.
 * Cleaner UX than re-issuing `action: 'set_candidate'` just to nudge the
 * percentage. 0 = effectively pause the candidate without clearing it; the
 * upper bound is the MAX_CANDIDATE_TRAFFIC_PERCENT guard rail.
 */
router.patch(
  '/:name/traffic',
  asyncHandler(async (req, res) => {
    const body = TrafficUpdateSchema.parse(req.body);
    const name = String(req.params.name);
    const config = await AgentConfig.findOne({ name });
    if (!config) throw new Error('Agent not found');
    if (config.candidatePromptVersion == null) {
      throw new Error(
        'No candidate version set — make a candidate before adjusting traffic.',
      );
    }
    const updated = await AgentConfig.findOneAndUpdate(
      { name },
      { $set: { candidateTrafficPercent: body.trafficPercent } },
      { new: true },
    );
    await agentRegistry.forceReload();
    res.json({ success: true, config: updated });
  }),
);

router.get(
  '/approvals/pending',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.skip) || 0;
    const entries = await agentApprovalQueueService.listPending({
      agentName: (req.query.agentName as string) || undefined,
      channel: (req.query.channel as string) || undefined,
      limit,
      skip,
    });
    res.json({ success: true, entries });
  }),
);

router.post(
  '/approvals/:id/approve',
  asyncHandler(async (req, res) => {
    const result = await agentApprovalQueueService.approve(
      String(req.params.id),
      adminUser(req),
    );
    res.json({
      success: true,
      outbound: result.outbound,
      entry: result.entry,
    });
  }),
);

router.post(
  '/approvals/:id/reject',
  asyncHandler(async (req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note : null;
    const entry = await agentApprovalQueueService.reject(
      String(req.params.id),
      adminUser(req),
      note,
    );
    res.json({ success: true, entry });
  }),
);

router.post(
  '/approvals/:id/edit',
  asyncHandler(async (req, res) => {
    const editedText = String(req.body?.editedText ?? '').trim();
    if (!editedText) throw new Error('editedText is required');
    const note = typeof req.body?.note === 'string' ? req.body.note : null;
    const result = await agentApprovalQueueService.edit(
      String(req.params.id),
      adminUser(req),
      editedText,
      note,
    );
    res.json({
      success: true,
      outbound: result.outbound,
      entry: result.entry,
    });
  }),
);

router.post(
  '/feedback',
  asyncHandler(async (req, res) => {
    const body = FeedbackCreateSchema.parse(req.body);
    const exec = await AgentExecution.findById(body.executionId);
    if (!exec) throw new Error('Execution not found');
    const fb = await AgentFeedback.create({
      executionId: exec._id,
      agentName: exec.agentName,
      promptVersion: exec.promptVersion,
      source: 'admin_manual',
      score: body.score,
      note: body.note ?? null,
      createdBy: adminUser(req),
    });
    res.json({ success: true, feedback: fb });
  }),
);

router.get(
  '/traces/list',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.skip) || 0;
    const filter: Record<string, unknown> = {};
    if (req.query.agentName) filter.agentName = req.query.agentName;
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.outcome) filter.outcome = req.query.outcome;
    const [items, total] = await Promise.all([
      AgentExecution.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      AgentExecution.countDocuments(filter),
    ]);
    res.json({ success: true, items, total });
  }),
);

router.get(
  '/budgets/today',
  asyncHandler(async (_req, res) => {
    const configs = await AgentConfig.find({ isActive: true });
    const rows = await Promise.all(
      configs.map(async (c) => {
        const stats = await agentBudgetService.todayStats(c.name);
        return {
          agentName: c.name,
          ...stats,
          budgetTokensPerDay: c.budgetTokensPerDay,
          costCapUsdPerDay: c.costCapUsdPerDay,
        };
      }),
    );
    res.json({ success: true, rows });
  }),
);

router.post(
  '/registry/reload',
  asyncHandler(async (_req, res) => {
    await agentRegistry.forceReload();
    res.json({ success: true, registered: agentRegistry.list() });
  }),
);

export default router;
