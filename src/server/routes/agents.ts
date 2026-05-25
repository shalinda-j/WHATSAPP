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

/**
 * Side-by-side metrics for current vs candidate prompt versions over the
 * trailing N days. Sourced from AgentExecution (the durable record) +
 * AgentFeedback (operator/lead/booking outcomes) rather than the cumulative
 * counters on AgentPromptVersion.metrics, so the window is honest even when
 * versions have been around for months.
 */
router.get(
  '/:name/comparison',
  asyncHandler(async (req, res) => {
    const name = String(req.params.name);
    const days = Math.max(1, Math.min(Number(req.query.days) || 7, 90));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const config = await AgentConfig.findOne({ name });
    if (!config) throw new Error('Agent not found');

    const versions = [config.currentPromptVersion];
    if (config.candidatePromptVersion != null) {
      versions.push(config.candidatePromptVersion);
    }

    const stats = await AgentExecution.aggregate([
      {
        $match: {
          agentName: name,
          promptVersion: { $in: versions },
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: '$promptVersion',
          executions: { $sum: 1 },
          successes: {
            $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] },
          },
          failures: {
            $sum: { $cond: [{ $eq: ['$outcome', 'failed'] }, 1, 0] },
          },
          queuedForApproval: {
            $sum: {
              $cond: [{ $eq: ['$outcome', 'queued_for_approval'] }, 1, 0],
            },
          },
          rejectedByAdmin: {
            $sum: {
              $cond: [{ $eq: ['$outcome', 'rejected_by_admin'] }, 1, 0],
            },
          },
          totalTokens: { $sum: '$tokensUsed' },
          totalCostUsd: { $sum: '$costUsd' },
          totalLatencyMs: { $sum: '$latencyMs' },
          avgConfidence: { $avg: '$confidence' },
        },
      },
    ]);

    // Per-day series so the UI can sparkline / chart it later. Kept as a
    // sibling aggregation rather than $unwind-ing for clarity.
    const daily = await AgentExecution.aggregate([
      {
        $match: {
          agentName: name,
          promptVersion: { $in: versions },
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            version: '$promptVersion',
            date: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
          },
          executions: { $sum: 1 },
          costUsd: { $sum: '$costUsd' },
        },
      },
      { $sort: { '_id.date': 1 } },
    ]);

    const feedback = await AgentFeedback.aggregate([
      {
        $match: {
          agentName: name,
          promptVersion: { $in: versions },
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: '$promptVersion',
          positive: {
            $sum: { $cond: [{ $eq: ['$score', 1] }, 1, 0] },
          },
          negative: {
            $sum: { $cond: [{ $eq: ['$score', -1] }, 1, 0] },
          },
          neutral: {
            $sum: { $cond: [{ $eq: ['$score', 0] }, 1, 0] },
          },
        },
      },
    ]);

    type RawStat = {
      _id: number;
      executions: number;
      successes: number;
      failures: number;
      queuedForApproval: number;
      rejectedByAdmin: number;
      totalTokens: number;
      totalCostUsd: number;
      totalLatencyMs: number;
      avgConfidence: number | null;
    };
    type RawFb = {
      _id: number;
      positive: number;
      negative: number;
      neutral: number;
    };

    const statsByVersion = new Map<number, RawStat>(
      (stats as RawStat[]).map((s) => [s._id, s]),
    );
    const fbByVersion = new Map<number, RawFb>(
      (feedback as RawFb[]).map((f) => [f._id, f]),
    );

    const build = (version: number) => {
      const s = statsByVersion.get(version);
      const f = fbByVersion.get(version);
      const executions = s?.executions ?? 0;
      return {
        version,
        executions,
        successes: s?.successes ?? 0,
        failures: s?.failures ?? 0,
        queuedForApproval: s?.queuedForApproval ?? 0,
        rejectedByAdmin: s?.rejectedByAdmin ?? 0,
        totalTokens: s?.totalTokens ?? 0,
        totalCostUsd: s?.totalCostUsd ?? 0,
        avgLatencyMs:
          executions > 0 && s ? Math.round(s.totalLatencyMs / executions) : 0,
        avgConfidence: s?.avgConfidence ?? null,
        positiveFeedback: f?.positive ?? 0,
        negativeFeedback: f?.negative ?? 0,
        neutralFeedback: f?.neutral ?? 0,
        // Net favourability — proxy for "is the candidate actually better"
        netScore:
          executions > 0
            ? ((f?.positive ?? 0) - (f?.negative ?? 0)) / executions
            : 0,
        avgCostPerExecution:
          executions > 0 ? (s?.totalCostUsd ?? 0) / executions : 0,
        rejectRate: executions > 0 ? (s?.rejectedByAdmin ?? 0) / executions : 0,
      };
    };

    res.json({
      success: true,
      days,
      since,
      current: build(config.currentPromptVersion),
      candidate:
        config.candidatePromptVersion != null
          ? build(config.candidatePromptVersion)
          : null,
      candidateTrafficPercent: config.candidateTrafficPercent,
      daily,
    });
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

/**
 * Per-agent latency + cost dashboard. Aggregates AgentExecution over the
 * requested window (default 7 days, max 90) and returns one row per agent:
 *   { executions, successRate, p50LatencyMs, p95LatencyMs, totalTokens,
 *     totalCostUsd, topFailures: [{reason, count}] }
 *
 * Uses a single Mongo aggregation per agent — bounded at top-N agents to
 * keep the cost predictable as the agent roster grows.
 */
router.get(
  '/metrics/dashboard',
  asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const aggregation = await AgentExecution.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$agentName',
          executions: { $sum: 1 },
          successes: {
            $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] },
          },
          failures: {
            $sum: { $cond: [{ $eq: ['$outcome', 'failed'] }, 1, 0] },
          },
          totalTokens: { $sum: '$tokensUsed' },
          totalCostUsd: { $sum: '$costUsd' },
          latencies: { $push: '$latencyMs' },
        },
      },
      { $sort: { executions: -1 } },
      { $limit: 50 },
    ]);

    type AggregationRow = {
      _id: string;
      executions: number;
      successes: number;
      failures: number;
      totalTokens: number;
      totalCostUsd: number;
      latencies: number[];
    };

    const percentile = (sorted: number[], p: number): number => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
      );
      return sorted[idx];
    };

    const rows = (aggregation as AggregationRow[]).map((r) => {
      const sortedLat = [...r.latencies].sort((a, b) => a - b);
      return {
        agentName: r._id,
        executions: r.executions,
        successRate: r.executions > 0 ? r.successes / r.executions : 0,
        failures: r.failures,
        p50LatencyMs: percentile(sortedLat, 50),
        p95LatencyMs: percentile(sortedLat, 95),
        totalTokens: r.totalTokens,
        totalCostUsd: Number(r.totalCostUsd.toFixed(4)),
        avgCostPerExecutionUsd:
          r.executions > 0
            ? Number((r.totalCostUsd / r.executions).toFixed(6))
            : 0,
      };
    });

    // Top failure reasons in the same window — capped at 20 distinct
    // messages so a noisy errorMessage column can't blow up the response.
    const failureReasons = await AgentExecution.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          outcome: 'failed',
          errorMessage: { $ne: null },
        },
      },
      { $group: { _id: '$errorMessage', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);

    res.json({
      success: true,
      windowDays: days,
      since,
      rows,
      topFailures: failureReasons.map((f: { _id: string; count: number }) => ({
        reason: f._id,
        count: f.count,
      })),
    });
  }),
);

export default router;
