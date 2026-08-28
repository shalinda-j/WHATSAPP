/**
 * AgentSkill admin endpoints. Mounted at /api/agent-skills.
 *
 * Skills are tenant-scoped — every operator manages their own library of
 * marketing / sales / tone instructions and chooses which agents they
 * apply to. The orchestrator pulls active assigned skills at inference
 * time and injects their promptSection into the agent's system prompt.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { asyncHandler } from '../middleware/asyncHandler';
import AgentSkill from '../../models/AgentSkill';
import { agentRegistry } from '../../agents/AgentRegistry';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

const SnippetSchema = z.object({
  input: z.string().min(1).max(4000),
  expectedOutput: z.string().min(1).max(4000),
  tags: z.array(z.string().max(60)).max(20).default([]),
});

const SkillCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  category: z
    .enum(['sales', 'marketing', 'support', 'personalisation', 'tone', 'other'])
    .default('other'),
  promptSection: z.string().min(10).max(4000),
  exampleSnippets: z.array(SnippetSchema).max(50).default([]),
  assignedAgents: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

const SkillPatchSchema = SkillCreateSchema.partial();

const AssignSchema = z.object({
  assignedAgents: z.array(z.string()),
});

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });
    const { agent, category, active } = req.query as Record<string, string>;
    const filter: Record<string, unknown> = { tenantId };
    if (agent) filter.assignedAgents = agent;
    if (category) filter.category = category;
    if (active === 'true') filter.isActive = true;
    if (active === 'false') filter.isActive = false;
    const skills = await AgentSkill.find(filter)
      .sort({ category: 1, name: 1 })
      .lean();
    res.json({
      skills,
      availableAgents: agentRegistry.list(),
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?._id;
    const skill = await AgentSkill.findOne({ _id: req.params.id, tenantId });
    if (!skill) return res.status(404).json({ error: 'not_found' });
    res.json({ skill });
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });
    const parsed = SkillCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    // Refuse to assign to an agent name the registry doesn't know — keeps
    // typos from creating dead-letter skills.
    const known = new Set(agentRegistry.list());
    const unknownAgents = parsed.data.assignedAgents.filter(
      (a) => !known.has(a),
    );
    if (unknownAgents.length > 0) {
      return res
        .status(400)
        .json({ error: 'unknown_agents', detail: unknownAgents });
    }
    const skill = await AgentSkill.create({
      ...parsed.data,
      tenantId,
    });
    res.status(201).json({ skill });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?._id;
    const parsed = SkillPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    if (parsed.data.assignedAgents) {
      const known = new Set(agentRegistry.list());
      const unknownAgents = parsed.data.assignedAgents.filter(
        (a) => !known.has(a),
      );
      if (unknownAgents.length > 0) {
        return res
          .status(400)
          .json({ error: 'unknown_agents', detail: unknownAgents });
      }
    }
    const skill = await AgentSkill.findOneAndUpdate(
      { _id: req.params.id, tenantId },
      { $set: parsed.data },
      { returnDocument: 'after' },
    );
    if (!skill) return res.status(404).json({ error: 'not_found' });
    res.json({ skill });
  }),
);

router.patch(
  '/:id/assign',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?._id;
    const parsed = AssignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const known = new Set(agentRegistry.list());
    const unknownAgents = parsed.data.assignedAgents.filter(
      (a) => !known.has(a),
    );
    if (unknownAgents.length > 0) {
      return res
        .status(400)
        .json({ error: 'unknown_agents', detail: unknownAgents });
    }
    const skill = await AgentSkill.findOneAndUpdate(
      { _id: req.params.id, tenantId },
      { $set: { assignedAgents: parsed.data.assignedAgents } },
      { returnDocument: 'after' },
    );
    if (!skill) return res.status(404).json({ error: 'not_found' });
    res.json({ skill });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?._id;
    await AgentSkill.deleteOne({ _id: req.params.id, tenantId });
    res.status(204).end();
  }),
);

export default router;
