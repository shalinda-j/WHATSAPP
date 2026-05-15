import { z } from 'zod';
import { IAgent } from '../interfaces/IAgent';
import {
  AgentContext,
  AgentResult,
  AgentMode,
  ChannelSchema,
} from '../types/agent';
import { aiLoadBalancer } from '../services/AILoadBalancer';
import { Contact } from '../models/CRM';
import Lead from '../models/Lead';
import { FOLLOWUP_V1_PROMPT } from './prompts/followup-v1';

const COST_PER_TOKEN = 0.0000002;

const FollowUpOutputSchema = z.object({
  shouldFollowUp: z.boolean(),
  skipReason: z.string().nullable().default(null),
  message: z.string().min(1).max(1500).nullable(),
  channel: ChannelSchema,
  nextCheckInDays: z.number().int().min(0).max(365).default(7),
  confidence: z.number().min(0).max(1),
});
type FollowUpOutput = z.infer<typeof FollowUpOutputSchema>;

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * FollowUpAgent — drafts personalised re-engagement messages for dormant
 * leads. Cron-invoked (see followUpScheduler), so canHandle() returns 0 on
 * inbound. ctx.metadata MUST carry `lead` and `contact` objects when the
 * scheduler invokes execute() — this lets the agent see prior BANT
 * signals + brand voice without re-querying inside the hot path.
 */
export class FollowUpAgent implements IAgent {
  name = 'follow_up';
  description =
    'Drafts re-engagement messages for dormant leads — language-mirrored, quiet-hours-aware, low-pressure.';
  mode: AgentMode = 'disabled';

  async canHandle(_ctx: AgentContext): Promise<number> {
    // Cron-invoked only; never scores on inbound.
    return 0;
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const promptVersion = ctx.assignedPrompt?.version ?? 1;
    const systemPrompt = ctx.assignedPrompt?.systemPrompt ?? FOLLOWUP_V1_PROMPT;

    const lead =
      (ctx.metadata?.lead as Record<string, unknown> | undefined) ?? null;
    const contact =
      (ctx.metadata?.contact as Record<string, unknown> | undefined) ?? null;
    const daysAgo = Number(ctx.metadata?.daysSinceLastInteraction ?? 0);

    const profile = {
      language: ctx.language,
      tags: (contact?.tags as string[] | undefined) ?? [],
      lifecycleStage:
        (contact?.status as string | undefined) ??
        (lead?.status as string | undefined) ??
        'unknown',
      name: (contact?.name as string | undefined) ?? null,
    };
    const lastInteraction = {
      daysAgo,
      summary:
        (contact?.lastInteraction as string | undefined) ??
        'no previous interaction summary',
      lastMessageDirection:
        (ctx.metadata?.lastMessageDirection as string | undefined) ?? 'inbound',
    };
    const leadContext = lead
      ? {
          status: lead.status,
          jobVacancyType: lead.jobVacancyType,
          interestedCountry: lead.interestedCountry,
          experienceYears: lead.experienceYears,
          notes: (lead.notes as string | undefined)?.slice(0, 500),
        }
      : null;

    const userMessage = [
      `CONTACT_PROFILE: ${JSON.stringify(profile)}`,
      `LAST_INTERACTION: ${JSON.stringify(lastInteraction)}`,
      `LEAD_CONTEXT: ${JSON.stringify(leadContext)}`,
      `BRAND_VOICE: ${ctx.metadata?.brandVoice ?? 'warm, professional, Sinhala-first'}`,
    ].join('\n');

    let raw;
    try {
      raw = await aiLoadBalancer.sendMessageRaw({
        systemPrompt,
        userMessage,
      });
    } catch (err: any) {
      return this.failed(
        promptVersion,
        start,
        err?.message ?? 'LLM call failed',
      );
    }

    let parsed: FollowUpOutput;
    try {
      const json = JSON.parse(stripJsonFences(raw.text));
      const result = FollowUpOutputSchema.safeParse(json);
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

    const tokensUsed = raw.inputTokens + raw.outputTokens;
    const baseLatency = Date.now() - start;

    if (!parsed.shouldFollowUp || !parsed.message) {
      return {
        agentName: this.name,
        promptVersion,
        confidence: parsed.confidence,
        outbound: null,
        outcome: 'success',
        tokensUsed,
        costUsd: tokensUsed * COST_PER_TOKEN,
        latencyMs: baseLatency,
        sideEffects: [],
        reflectionNote: parsed.skipReason ?? 'no_skip_reason_given',
      };
    }

    return {
      agentName: this.name,
      promptVersion,
      confidence: parsed.confidence,
      outbound: {
        text: parsed.message,
      },
      outcome: 'pending',
      tokensUsed,
      costUsd: tokensUsed * COST_PER_TOKEN,
      latencyMs: baseLatency,
      sideEffects: [
        {
          kind: 'memory.write',
          targetId:
            (ctx.metadata?.contactId as string | undefined) ?? ctx.userId,
          payload: {
            kind: 'follow_up_scheduled',
            nextCheckInDays: parsed.nextCheckInDays,
          },
        },
      ],
    };
  }

  async reflect(
    _ctx: AgentContext,
    result: AgentResult,
  ): Promise<string | null> {
    if (result.outbound && result.confidence < 0.45) {
      return 'low-confidence follow-up surfaced — consider running in approval mode';
    }
    return null;
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

// silence unused (kept for the scheduler module that lives in
// FollowUpScheduler.ts and pulls Lead/Contact data per dormant row)
void Lead;
void Contact;
