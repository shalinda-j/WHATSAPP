import mongoose from 'mongoose';
import { z } from 'zod';
import ContactSegment, { IContactSegment } from '../models/ContactSegment';
import AgentPromptVersion from '../models/AgentPromptVersion';
import { aiLoadBalancer } from './AILoadBalancer';
import { SEGMENTATION_V1_PROMPT } from '../agents/prompts/segmentation-v1';

export interface MaterialisedRecipient {
  contactId: string;
  handles: Partial<Record<string, string>>; // channel -> external id
}

export interface DescribeSegmentOptions {
  tenantId: string;
  description: string;
}

const RULE_OPERATORS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'exists',
] as const;

const RuleSchema = z.object({
  field: z.string().min(1).max(120),
  operator: z.enum(RULE_OPERATORS),
  value: z.unknown(),
});

const SegmentDraftSchema = z.object({
  segmentName: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  rules: z.array(RuleSchema).max(20),
  or: z.array(z.array(RuleSchema).max(20)).max(5).optional(),
  estimatedSize: z
    .enum(['small', 'medium', 'large', 'unknown'])
    .default('unknown'),
  warnings: z.array(z.string()).default([]),
});

type SegmentDraft = z.infer<typeof SegmentDraftSchema>;

// Field paths the SegmentationAgent is allowed to reference. Anything
// outside this list is dropped so the LLM can't write rules against
// non-existent fields and produce silent zero-match segments.
const ALLOWED_FIELDS = new Set<string>([
  'lead.status',
  'lead.jobVacancyType',
  'lead.interestedCountry',
  'lead.experienceYears',
  'lead.age',
  'lead.source',
  'lead.registeredAt',
  'lead.updatedAt',
  'contact.tags',
  'contact.lifecycleStage',
  'contact.lastInteractionAt',
  'contact.language',
  'contact.country',
]);

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

function filterRulesToAllowedFields(rules: SegmentDraft['rules']) {
  return rules.filter((r) => ALLOWED_FIELDS.has(r.field));
}

export class SegmentationService {
  async list(tenantId: string): Promise<IContactSegment[]> {
    return ContactSegment.find({ tenantId }).sort({ name: 1 });
  }

  async create(
    tenantId: string,
    payload: Partial<IContactSegment>,
  ): Promise<IContactSegment> {
    return ContactSegment.create({
      ...payload,
      tenantId: new mongoose.Types.ObjectId(tenantId),
    });
  }

  async update(
    tenantId: string,
    segmentId: string,
    patch: Partial<IContactSegment>,
  ): Promise<IContactSegment | null> {
    return ContactSegment.findOneAndUpdate(
      { _id: segmentId, tenantId },
      { $set: patch },
      { new: true },
    );
  }

  /**
   * Translates a plain-language segment description into a structured rule
   * draft via the SegmentationAgent's v1 prompt. The draft is returned to
   * the operator for review BEFORE the segment is persisted — the agent
   * never writes directly to ContactSegment. Field paths the LLM proposes
   * are filtered against ALLOWED_FIELDS so it can't reference fields that
   * don't exist on the Contact/Lead schema.
   */
  async describeSegment(opts: DescribeSegmentOptions): Promise<{
    draft: SegmentDraft;
    droppedRules: number;
    tokensUsed: number;
    provider: string;
  }> {
    const availableFields = Array.from(ALLOWED_FIELDS)
      .map((f) => `- ${f}`)
      .join('\n');
    const userMessage = [
      `DESCRIPTION: ${opts.description}`,
      'AVAILABLE_FIELDS:',
      availableFields,
    ].join('\n');

    const raw = await aiLoadBalancer.sendMessageRaw({
      systemPrompt: SEGMENTATION_V1_PROMPT,
      userMessage,
    });

    let parsed: SegmentDraft;
    try {
      const json = JSON.parse(stripJsonFences(raw.text));
      const result = SegmentDraftSchema.safeParse(json);
      if (!result.success) {
        throw new Error(
          `segment_output_invalid: ${result.error.message.slice(0, 200)}`,
        );
      }
      parsed = result.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`segment_parse_failed: ${msg}`);
    }

    const originalRuleCount =
      parsed.rules.length +
      (parsed.or ?? []).reduce((sum, group) => sum + group.length, 0);
    parsed.rules = filterRulesToAllowedFields(parsed.rules);
    if (parsed.or) {
      parsed.or = parsed.or
        .map((group) => filterRulesToAllowedFields(group))
        .filter((group) => group.length > 0);
    }
    const keptRuleCount =
      parsed.rules.length +
      (parsed.or ?? []).reduce((sum, group) => sum + group.length, 0);
    const droppedRules = Math.max(0, originalRuleCount - keptRuleCount);
    if (droppedRules > 0) {
      parsed.warnings = [
        ...parsed.warnings,
        `${droppedRules} rule(s) referenced unknown fields and were dropped`,
      ];
    }

    const tokensUsed = raw.inputTokens + raw.outputTokens;
    AgentPromptVersion.updateOne(
      { agentName: 'segmentation', version: 1 },
      {
        $inc: {
          'metrics.uses': 1,
          'metrics.totalLatencyMs': raw.latencyMs,
          'metrics.totalTokens': tokensUsed,
        },
        $set: { 'metrics.lastUsedAt': new Date() },
      },
    ).catch((err) =>
      console.error('SegmentationService.describeSegment metrics:', err),
    );

    return {
      draft: parsed,
      droppedRules,
      tokensUsed,
      provider: raw.provider,
    };
  }

  /**
   * Compile rules → Mongo filter → count of matching contacts.
   * Phase 3 wiring writes against the actual Contact/Lead collections;
   * for now returns the current memberCount.
   */
  async recompute(tenantId: string, segmentId: string): Promise<number> {
    const segment = await ContactSegment.findOne({
      _id: segmentId,
      tenantId,
    });
    if (!segment) return 0;
    // Phase 3: const filter = compileRulesToMongoFilter(segment.rules, segment.or)
    //          const count = await Contact.countDocuments({ tenantId, ...filter })
    await ContactSegment.updateOne(
      { _id: segmentId, tenantId },
      { $set: { lastComputedAt: new Date() } },
    );
    return segment.memberCount;
  }

  async materialise(
    _tenantId: string,
    _segmentId: string,
  ): Promise<MaterialisedRecipient[]> {
    return [];
  }
}

export const segmentationService = new SegmentationService();
