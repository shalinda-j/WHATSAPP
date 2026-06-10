import mongoose from 'mongoose';
import { z } from 'zod';
import ContactSegment, { IContactSegment } from '../models/ContactSegment';
import AgentPromptVersion from '../models/AgentPromptVersion';
import { Contact } from '../models/CRM';
import Lead from '../models/Lead';
import { aiLoadBalancer } from './AILoadBalancer';
import { SEGMENTATION_V1_PROMPT } from '../agents/prompts/segmentation-v1';
import { compileSegmentRules, SegmentRule } from './SegmentRuleCompiler';

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
   *
   * The segment's rule list may contain a mix of 'contact.*' and 'lead.*'
   * paths. The compiler returns one filter per scope; the count returned
   * is the size of the contact set, with any lead-scoped rule narrowing
   * it down via an intermediate Lead.distinct('phoneNumber') lookup.
   */
  async recompute(tenantId: string, segmentId: string): Promise<number> {
    const segment = await ContactSegment.findOne({
      _id: segmentId,
      tenantId,
    });
    if (!segment) return 0;

    const allRules: SegmentRule[] = (segment.rules ?? []) as SegmentRule[];
    const orGroups: SegmentRule[][] | undefined = segment.or as
      | SegmentRule[][]
      | undefined;

    const contactCompile = compileSegmentRules(allRules, orGroups, {
      scope: 'contact',
    });
    const leadCompile = compileSegmentRules(allRules, orGroups, {
      scope: 'lead',
    });

    const contactFilter: Record<string, unknown> = {
      ...contactCompile.filter,
    };

    // If any lead-scoped rules exist, intersect contacts by phoneNumber.
    if (Object.keys(leadCompile.filter).length > 0) {
      const phones = await Lead.distinct('phoneNumber', leadCompile.filter);
      const phoneStrings = phones
        .filter((p: unknown): p is string => typeof p === 'string')
        .map((p: string) => p.replace(/\D/g, ''))
        .filter((p: string) => p.length > 0);
      const phoneRegexes = phoneStrings.map((p: string) => new RegExp(`${p}$`));
      if (phoneRegexes.length === 0) {
        // No matching leads → segment is empty.
        await ContactSegment.updateOne(
          { _id: segmentId, tenantId },
          { $set: { memberCount: 0, lastComputedAt: new Date() } },
        );
        return 0;
      }
      const existing = (contactFilter.$or as unknown[]) ?? [];
      contactFilter.$or = [
        ...existing,
        { phone: { $in: phoneRegexes } },
        { whatsappNumber: { $in: phoneRegexes } },
        { whatsappId: { $in: phoneRegexes } },
      ];
    }

    const count = await Contact.countDocuments(contactFilter);
    await ContactSegment.updateOne(
      { _id: segmentId, tenantId },
      { $set: { memberCount: count, lastComputedAt: new Date() } },
    );
    return count;
  }

  /**
   * Expand a segment to a list of MaterialisedRecipient rows that the
   * campaign sender can address. Reuses the same compile path as
   * recompute() so a launched campaign targets the exact same set the
   * operator saw in /segments.
   */
  async materialise(
    tenantId: string,
    segmentId: string,
  ): Promise<MaterialisedRecipient[]> {
    const segment = await ContactSegment.findOne({
      _id: segmentId,
      tenantId,
    });
    if (!segment) return [];

    const allRules = (segment.rules ?? []) as SegmentRule[];
    const orGroups = segment.or as SegmentRule[][] | undefined;

    const contactCompile = compileSegmentRules(allRules, orGroups, {
      scope: 'contact',
    });
    const leadCompile = compileSegmentRules(allRules, orGroups, {
      scope: 'lead',
    });

    const contactFilter: Record<string, unknown> = {
      ...contactCompile.filter,
    };
    if (Object.keys(leadCompile.filter).length > 0) {
      const phones = await Lead.distinct('phoneNumber', leadCompile.filter);
      const phoneStrings = phones
        .filter((p: unknown): p is string => typeof p === 'string')
        .map((p: string) => p.replace(/\D/g, ''))
        .filter((p: string) => p.length > 0);
      if (phoneStrings.length === 0) return [];
      const phoneRegexes = phoneStrings.map((p: string) => new RegExp(`${p}$`));
      const existing = (contactFilter.$or as unknown[]) ?? [];
      contactFilter.$or = [
        ...existing,
        { phone: { $in: phoneRegexes } },
        { whatsappNumber: { $in: phoneRegexes } },
        { whatsappId: { $in: phoneRegexes } },
      ];
    }

    // Performance: Skip Mongoose hydration and fetch only needed routing fields.
    // This reduces memory overhead for large bulk lists up to 10k contacts.
    const contacts = await Contact.find(contactFilter)
      .limit(10_000)
      .select('_id whatsappNumber whatsappId phone email')
      .lean();

    return contacts.map((c: any) => ({
      contactId: String(c._id),
      handles: {
        whatsapp: c.whatsappNumber || c.whatsappId || c.phone,
        email: c.email,
      },
    }));
  }
}

export const segmentationService = new SegmentationService();
