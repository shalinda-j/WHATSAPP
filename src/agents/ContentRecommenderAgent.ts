import { z } from 'zod';
import { IAgent } from '../interfaces/IAgent';
import { AgentContext, AgentResult, AgentMode } from '../types/agent';
import { aiLoadBalancer } from '../services/AILoadBalancer';
import { Contact } from '../models/CRM';
import KnowledgeEntry from '../models/KnowledgeEntry';
import { CONTENT_RECOMMENDER_V1_PROMPT } from './prompts/content-recommender-v1';
import { withOperatorPersona } from './composeSystemPrompt';

const PRODUCT_TOKENS = [
  'how',
  'what',
  'why',
  'when',
  'where',
  'price',
  'cost',
  'fee',
  'salary',
  'job',
  'jobs',
  'package',
  'visa',
  'training',
  'process',
  'detail',
  'details',
  'kohomada',
  'kohomda',
  'kiyada',
  'kavadada',
  'koheda',
  'kiyakda',
];

const COST_PER_TOKEN = 0.0000002;

const RecommenderOutputSchema = z.object({
  recommendation: z
    .object({
      contentId: z.string().min(1),
      rationale: z.string().min(1).max(400),
      confidence: z.number().min(0).max(1),
      suggestedMessage: z.string().min(1).max(1500),
      suggestedDelaySec: z.number().int().min(0).max(86400).default(0),
    })
    .nullable(),
  alternativesById: z.array(z.string()).max(3).default([]),
});
type RecommenderOutput = z.infer<typeof RecommenderOutputSchema>;

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

function phoneFromJid(jid: string): string {
  const m = jid.match(/^(\d+)/);
  return m ? m[1] : jid;
}

interface AvailableContentItem {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  format: 'qa';
  language: string;
}

/**
 * ContentRecommenderAgent — picks the next-best knowledge entry to surface
 * for a contact's question. Picks one of the operator's existing
 * KnowledgeEntry rows (filtered by language + active) and crafts a
 * language-mirrored intro line that frames the answer. Never invents
 * content; refuses if no entry is a good fit.
 */
export class ContentRecommenderAgent implements IAgent {
  name = 'content_recommender';
  description =
    'Recommends the next-best knowledge entry for a contact based on their question and profile.';
  mode: AgentMode = 'disabled';

  async canHandle(ctx: AgentContext): Promise<number> {
    const text = ctx.inputMessage.toLowerCase();
    if (text.length < 4) return 0;
    let hits = 0;
    for (const k of PRODUCT_TOKENS) {
      if (text.includes(k)) hits++;
    }
    if (hits === 0) return 0;
    // Cap below 0.7 so LeadQualifier and DealAgent can outscore on
    // strong qualification / booking signals.
    return Math.min(0.35 + hits * 0.08, 0.7);
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const promptVersion = ctx.assignedPrompt?.version ?? 1;
    const systemPrompt = await withOperatorPersona(
      ctx.assignedPrompt?.systemPrompt ?? CONTENT_RECOMMENDER_V1_PROMPT,
    );

    // Pull a candidate set of content items the LLM can choose from.
    // Filter by tenant language (default 'si') + active. Cap size so
    // the prompt context stays under tokens.
    const tenantId = (ctx.metadata as any)?.tenantId as string | undefined;
    const knowledgeFilter: any = {
      isActive: true,
      $or: [{ language: ctx.language }, { language: 'all' }],
    };
    // Scope to the tenant when known, tolerating legacy rows that predate the
    // tenantId field. The language match already uses $or, so combine both via
    // $and to avoid overwriting it.
    if (tenantId) {
      knowledgeFilter.$and = [
        { $or: knowledgeFilter.$or },
        {
          $or: [
            { tenantId },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ],
        },
      ];
      delete knowledgeFilter.$or;
    }
    const entries = await KnowledgeEntry.find(knowledgeFilter).limit(30);

    if (entries.length === 0) {
      return this.silent(promptVersion, start, 'no_content_available');
    }

    // Keep the UNTRUNCATED answer keyed by id. `summary` below is sliced to
    // 400 chars purely to keep the LLM prompt within budget — but the chosen
    // entry's answer is what we actually send to the customer, so reusing the
    // truncated `summary` for the outbound message cut long answers off
    // mid-sentence. Compose the reply from this full-text map instead.
    const fullAnswerById = new Map<string, string>(
      entries.map((e: any) => [String(e._id), String(e.answer)]),
    );
    const available: AvailableContentItem[] = entries.map((e: any) => ({
      id: String(e._id),
      title: String(e.question).slice(0, 200),
      summary: String(e.answer).slice(0, 400),
      tags: (e.tags ?? []) as string[],
      format: 'qa' as const,
      language: e.language ?? 'all',
    }));
    const allowedIds = new Set(available.map((c) => c.id));

    // Build CONTACT_PROFILE from CRM if known; fall back to a minimal
    // anonymous profile so the agent still mirrors language.
    const phone = phoneFromJid(ctx.userId);
    // Tenant-scope the contact lookup (legacy-tolerant), consistent with the
    // KnowledgeEntry query above — otherwise CONTACT_PROFILE (tags,
    // lifecycleStage) could be built from another tenant's contact that shares
    // the same phone number.
    const recommenderContactPhoneClause = {
      $or: [{ phone }, { whatsappNumber: phone }, { whatsappId: phone }],
    };
    const contact = await Contact.findOne(
      tenantId
        ? {
            $and: [
              recommenderContactPhoneClause,
              {
                $or: [
                  { tenantId },
                  { tenantId: { $exists: false } },
                  { tenantId: null },
                ],
              },
            ],
          }
        : recommenderContactPhoneClause,
    );
    const contactProfile = {
      language: ctx.language,
      tags: contact?.tags ?? [],
      lifecycleStage: contact?.status ?? 'unknown',
      recentInteractionSummary:
        contact?.lastInteraction ?? 'no prior interaction recorded',
    };

    const userMessage = [
      'CONTACT_PROFILE:',
      JSON.stringify(contactProfile),
      'AVAILABLE_CONTENT:',
      JSON.stringify(available),
      'RECENT_SENDS: []',
      'GOAL: nurture',
      `INBOUND_QUESTION: ${ctx.inputMessage.slice(0, 600)}`,
    ].join('\n');

    let raw;
    try {
      raw = await aiLoadBalancer.sendMessageRaw({
        systemPrompt,
        providerOverride: ctx.providerOverride,
        modelOverride: ctx.modelOverride,
        userMessage,
        history: ctx.conversationHistory.slice(-4).map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
    } catch (err: any) {
      return this.failed(
        promptVersion,
        start,
        err?.message ?? 'LLM call failed',
      );
    }

    let parsed: RecommenderOutput;
    try {
      const json = JSON.parse(stripJsonFences(raw.text));
      const result = RecommenderOutputSchema.safeParse(json);
      if (!result.success) {
        return this.failed(
          promptVersion,
          start,
          `schema: ${result.error.message.slice(0, 200)}`,
          raw.inputTokens + raw.outputTokens,
        );
      }
      parsed = result.data;
    } catch (err: any) {
      return this.failed(
        promptVersion,
        start,
        `parse: ${err?.message ?? 'unknown'}`,
        raw.inputTokens + raw.outputTokens,
      );
    }

    // Firewall against hallucinated content ids.
    if (
      parsed.recommendation &&
      !allowedIds.has(parsed.recommendation.contentId)
    ) {
      return this.failed(
        promptVersion,
        start,
        'rec_returned_unknown_content_id',
        raw.inputTokens + raw.outputTokens,
      );
    }

    if (!parsed.recommendation) {
      return this.silent(
        promptVersion,
        start,
        'no_good_fit',
        raw.inputTokens + raw.outputTokens,
      );
    }

    // parsed.recommendation is non-null here (checked above) and chosen is
    // guaranteed by the allowedIds firewall — but lint prefers explicit
    // checks over !-assertions.
    const recommendation = parsed.recommendation;
    const chosen = available.find((c) => c.id === recommendation.contentId);
    if (!chosen) {
      return this.failed(
        promptVersion,
        start,
        'rec_returned_unknown_content_id_after_check',
        raw.inputTokens + raw.outputTokens,
      );
    }
    // Use the untruncated answer for the customer-facing reply; fall back to
    // the 400-char prompt summary only if the full text is somehow missing.
    const chosenAnswer = fullAnswerById.get(chosen.id) ?? chosen.summary;
    const messageBody = `${recommendation.suggestedMessage.trim()}\n\n${chosenAnswer}`;

    // Fire-and-forget: bump KnowledgeEntry.usageCount + touch lastUsedAt.
    KnowledgeEntry.updateOne(
      { _id: chosen.id },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
    ).catch((err: unknown) =>
      console.error('ContentRecommender: usage bump failed:', err),
    );

    const tokensUsed = raw.inputTokens + raw.outputTokens;
    return {
      agentName: this.name,
      promptVersion,
      confidence: recommendation.confidence,
      outbound: {
        text: messageBody,
        delayMs: (recommendation.suggestedDelaySec ?? 0) * 1000,
      },
      outcome: 'pending',
      tokensUsed,
      costUsd: tokensUsed * COST_PER_TOKEN,
      latencyMs: Date.now() - start,
      sideEffects: [
        {
          kind: 'memory.write',
          targetId: chosen.id,
          payload: { kind: 'content_recommended' },
        },
      ],
    };
  }

  async reflect(
    _ctx: AgentContext,
    result: AgentResult,
  ): Promise<string | null> {
    if (result.outbound && result.confidence < 0.4) {
      return 'low-confidence recommendation surfaced — review whether knowledge base needs new entries';
    }
    return null;
  }

  private silent(
    promptVersion: number,
    start: number,
    note: string,
    tokensUsed = 0,
  ): AgentResult {
    return {
      agentName: this.name,
      promptVersion,
      confidence: 0,
      outbound: null,
      outcome: 'success',
      tokensUsed,
      costUsd: tokensUsed * COST_PER_TOKEN,
      latencyMs: Date.now() - start,
      sideEffects: [],
      reflectionNote: note,
    };
  }

  private failed(
    promptVersion: number,
    start: number,
    note: string,
    tokensUsed = 0,
  ): AgentResult {
    return {
      agentName: this.name,
      promptVersion,
      confidence: 0,
      outbound: null,
      outcome: 'failed',
      tokensUsed,
      costUsd: tokensUsed * COST_PER_TOKEN,
      latencyMs: Date.now() - start,
      sideEffects: [],
      reflectionNote: note,
    };
  }
}
