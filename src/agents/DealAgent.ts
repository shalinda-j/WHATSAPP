import { z } from 'zod';
import { IAgent } from '../interfaces/IAgent';
import { AgentContext, AgentResult, AgentMode } from '../types/agent';
import { aiLoadBalancer } from '../services/AILoadBalancer';
import Lead from '../models/Lead';
import { DEAL_AGENT_V1_PROMPT } from './prompts/deal-agent-v1';
import { withOperatorPersona } from './composeSystemPrompt';

const BOOKING_INTENT_TOKENS = [
  'book',
  'booking',
  'schedule',
  'appointment',
  'interview',
  'slot',
  'slots',
  'available',
  'availability',
  'when can',
  'meet',
  'meeting',
  'visit',
  'call me',
  'arrange',
  'kalanaya',
  'kawadada',
  'velaawa',
  'vela',
  'samaagama',
  'haadda',
  'hadanna',
  'thiyenawa da',
  'ready',
  'yes please',
  'lets do',
  "let's do",
  'next step',
];

const DealOutputSchema = z.object({
  reply: z.string().min(1).max(1000),
  dealStage: z.enum([
    'new',
    'qualified',
    'proposal',
    'negotiation',
    'ready_to_book',
  ]),
  shouldStartBookingFlow: z.boolean(),
  preferredTimeHint: z.string().nullable(),
});
type DealOutput = z.infer<typeof DealOutputSchema>;

const COST_PER_TOKEN = 0.0000002;

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function phoneFromJid(jid: string): string {
  const m = jid.match(/^(\d+)/);
  return m ? m[1] : jid;
}

export class DealAgent implements IAgent {
  name = 'deal_agent';
  description =
    'Handles closing turns — proposes a concrete next step (booking, interview), personalizes using the Lead profile, and tags the CRM dealStage. Returns booking-time hints for downstream handling.';
  mode: AgentMode = 'disabled';

  async canHandle(ctx: AgentContext): Promise<number> {
    const text = ctx.inputMessage.toLowerCase();
    if (text.length < 2) return 0;
    let hits = 0;
    for (const t of BOOKING_INTENT_TOKENS) {
      if (text.includes(t)) hits++;
    }
    if (hits === 0) return 0;
    return Math.min(0.55 + hits * 0.12, 0.92);
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const promptVersion = ctx.assignedPrompt?.version ?? 1;
    const systemPrompt = await withOperatorPersona(
      ctx.assignedPrompt?.systemPrompt ?? DEAL_AGENT_V1_PROMPT,
    );

    const phone = phoneFromJid(ctx.userId);
    // Tenant-scope the lead lookup (legacy-tolerant), mirroring
    // LeadQualifierAgent. Without it, two tenants sharing a phone number let
    // DealAgent read — and then updateOne (status/notes) — the WRONG tenant's
    // lead, corrupting another tenant's CRM.
    const dealTenantId =
      typeof ctx.metadata?.tenantId === 'string' ? ctx.metadata.tenantId : null;
    const leadFilter: Record<string, unknown> = dealTenantId
      ? {
          phoneNumber: phone,
          $or: [
            { tenantId: dealTenantId },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ],
        }
      : { phoneNumber: phone };
    const lead = await Lead.findOne(leadFilter);
    const leadContext = lead
      ? {
          exists: true,
          jobVacancyType: lead.jobVacancyType ?? null,
          interestedCountry: lead.interestedCountry ?? null,
          experienceYears: lead.experienceYears ?? null,
          status: lead.status,
        }
      : { exists: false };

    const augmentedInput = `${
      ctx.inputMessage
    }\n\n=== LEAD_CONTEXT ===\n${JSON.stringify(
      leadContext,
    )}\n=== END_LEAD_CONTEXT ===`;

    let raw;
    try {
      raw = await aiLoadBalancer.sendMessageRaw({
        systemPrompt,
        userMessage: augmentedInput,
        history: ctx.conversationHistory.slice(-8).map((m) => ({
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

    let parsed: DealOutput;
    try {
      const json = JSON.parse(stripJsonFences(raw.text));
      const validated = DealOutputSchema.safeParse(json);
      if (!validated.success) {
        return this.failed(
          promptVersion,
          start,
          `Schema validation failed: ${validated.error.message.slice(0, 200)}`,
          raw.inputTokens + raw.outputTokens,
        );
      }
      parsed = validated.data;
    } catch (err: any) {
      return this.failed(
        promptVersion,
        start,
        `JSON parse failed: ${err?.message ?? 'unknown'}`,
        raw.inputTokens + raw.outputTokens,
      );
    }

    const sideEffects: AgentResult['sideEffects'] = [];

    if (lead && parsed.dealStage === 'ready_to_book' && lead.status === 'new') {
      await Lead.updateOne(
        { _id: lead._id },
        {
          $set: {
            status: 'reviewed',
            notes: appendNote(lead.notes, `DealStage: ready_to_book`),
          },
        },
      );
      sideEffects.push({
        kind: 'lead.update',
        targetId: String(lead._id),
        payload: { status: 'reviewed', dealStage: parsed.dealStage },
      });
    }

    // Hint payload that downstream code (booking flow integration, Phase 2)
    // can consume from the trace. shouldStartBookingFlow + preferredTimeHint
    // are intentionally NOT auto-acted upon yet — the existing BookingService
    // flow has its own state machine and we don't want two writers.
    if (parsed.shouldStartBookingFlow || parsed.preferredTimeHint) {
      sideEffects.push({
        kind: 'memory.write',
        payload: {
          tag: 'deal.booking_intent',
          shouldStartBookingFlow: parsed.shouldStartBookingFlow,
          preferredTimeHint: parsed.preferredTimeHint,
        },
      });
    }

    const tokensUsed = raw.inputTokens + raw.outputTokens;
    return {
      agentName: this.name,
      promptVersion,
      confidence: await this.canHandle(ctx),
      outbound: { text: parsed.reply },
      outcome: 'pending',
      tokensUsed,
      costUsd: tokensUsed * COST_PER_TOKEN,
      latencyMs: Date.now() - start,
      sideEffects,
    };
  }

  private failed(
    promptVersion: number,
    start: number,
    msg: string,
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
      reflectionNote: msg,
    };
  }
}

function appendNote(
  existing: string | null | undefined,
  addition: string,
): string {
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}\n${addition}`;
}
