import { z } from 'zod';
import { IAgent } from '../interfaces/IAgent';
import {
  AgentContext,
  AgentResult,
  AgentMode,
  BANTSignalSchema,
} from '../types/agent';
import { aiLoadBalancer } from '../services/AILoadBalancer';
import Lead from '../models/Lead';
import { LEAD_QUALIFIER_V1_PROMPT } from './prompts/lead-qualifier-v1';
import { withOperatorPersona } from './composeSystemPrompt';

// Heuristic keywords used by canHandle() for cheap routing. Multilingual on
// purpose — Romanised Sinhala/Tamil terms are how this user base actually
// types. canHandle() is intentionally a sub-ms keyword pass so the
// orchestrator can score all agents in parallel without LLM cost.
const TRIGGER_TOKENS = [
  'job',
  'jobs',
  'vacancy',
  'vacancies',
  'apply',
  'opportunity',
  'work',
  'rakiya',
  'rakeeya',
  'rakiyak',
  'welada',
  'wedek',
  'wadak',
  'wada',
  'rassawak',
  'rassawa',
  'japan',
  'korea',
  'qatar',
  'dubai',
  'saudi',
  'oman',
  'kuwait',
  'welding',
  'caregiver',
  'factory',
  'construction',
  'hotel',
  'experience',
  'salary',
  'visa',
  'training',
  'interested',
  'looking for',
  'mata one',
  'mata ona',
];

const QualifyOutputSchema = z.object({
  bant: BANTSignalSchema,
  reply: z.string().min(1).max(1000),
  shouldHandoff: z.boolean(),
});
type QualifyOutput = z.infer<typeof QualifyOutputSchema>;

// Conservative per-token cost estimate ($0.0000002 = $0.20 per 1M tokens).
// Tuned to roughly match a Groq llama-3.1-8b mix — exact per-provider cost
// will move to Config-driven calculation in a follow-up.
const COST_PER_TOKEN = 0.0000002;

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function extractPhoneFromJid(jid: string): string {
  // WhatsApp JIDs look like '94771234567@s.whatsapp.net' or
  // '94771234567:12@s.whatsapp.net'. Strip everything after the first
  // non-digit so the phone matches Lead.phoneNumber regardless of suffix.
  const m = jid.match(/^(\d+)/);
  return m ? m[1] : jid;
}

export class LeadQualifierAgent implements IAgent {
  name = 'lead_qualifier';
  description =
    'Qualifies new WhatsApp inquiries using BANT (Budget, Authority, Need, Timing), updates the matching Lead with validated fields only, and asks the next best qualifying question.';
  mode: AgentMode = 'disabled';

  async canHandle(ctx: AgentContext): Promise<number> {
    const text = ctx.inputMessage.toLowerCase();
    if (text.length < 2) return 0;
    let hits = 0;
    for (const k of TRIGGER_TOKENS) {
      if (text.includes(k)) hits++;
    }
    if (hits === 0) return 0;
    return Math.min(0.5 + hits * 0.12, 0.95);
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const promptVersion = ctx.assignedPrompt?.version ?? 1;
    const systemPrompt = await withOperatorPersona(
      ctx.assignedPrompt?.systemPrompt ?? LEAD_QUALIFIER_V1_PROMPT,
    );

    let raw;
    try {
      raw = await aiLoadBalancer.sendMessageRaw({
        systemPrompt,
        userMessage: ctx.inputMessage,
        history: ctx.conversationHistory.slice(-8).map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
    } catch (err: any) {
      return this.failed(
        ctx,
        promptVersion,
        start,
        err?.message ?? 'LLM call failed',
      );
    }

    let parsed: QualifyOutput;
    try {
      const json = JSON.parse(stripJsonFences(raw.text));
      const validated = QualifyOutputSchema.safeParse(json);
      if (!validated.success) {
        return this.failed(
          ctx,
          promptVersion,
          start,
          `Schema validation failed: ${validated.error.message.slice(0, 200)}`,
          raw.inputTokens + raw.outputTokens,
        );
      }
      parsed = validated.data;
    } catch (err: any) {
      return this.failed(
        ctx,
        promptVersion,
        start,
        `JSON parse failed: ${err?.message ?? 'unknown'}`,
        raw.inputTokens + raw.outputTokens,
      );
    }

    // Side-effect: upsert a Lead for this phone number so BANT data is never
    // discarded for first-time callers. We use $setOnInsert with minimal
    // required fields (fullName placeholder + jobVacancyType placeholder) so
    // the schema's required-field constraint is satisfied on insert, while
    // existing full-profile Leads are never overwritten. BANT updates are then
    // applied on top whether the record is new or pre-existing.
    const sideEffects: AgentResult['sideEffects'] = [];
    const phone = extractPhoneFromJid(ctx.userId);

    // Ensure a Lead row exists for this phone (upsert = create-if-missing).
    // $setOnInsert fields only apply when the document is newly created.
    const lead = await Lead.findOneAndUpdate(
      { phoneNumber: phone },
      {
        $setOnInsert: {
          fullName: `WhatsApp Enquiry (${phone})`,
          phoneNumber: phone,
          jobVacancyType: 'Pending Registration',
          source: 'whatsapp',
          status: 'new',
        },
      },
      { upsert: true, new: true },
    );

    // Apply BANT signals to whichever record we got (new or existing).
    if (lead) {
      const updates: Record<string, unknown> = {};
      const { bant } = parsed;

      // Only persist fields the LLM had direct evidence for (confidence
      // gate is the firewall against CRM hallucination — see prompt).
      if (
        bant.need &&
        bant.need.confidence >= 0.6 &&
        bant.need.summary &&
        (!lead.jobVacancyType || lead.jobVacancyType === 'Pending Registration')
      ) {
        updates.jobVacancyType = bant.need.summary.slice(0, 200);
      }
      if (
        bant.timing &&
        bant.timing.confidence >= 0.6 &&
        bant.timing.timeframe
      ) {
        const note = `Timing: ${bant.timing.timeframe}`;
        updates.notes = lead.notes ? `${lead.notes}\n${note}` : note;
      }
      if (bant.overallScore >= 0.7 && lead.status === 'new') {
        updates.status = 'reviewed';
      }

      if (Object.keys(updates).length > 0) {
        await Lead.updateOne({ _id: lead._id }, { $set: updates });
        sideEffects.push({
          kind: 'lead.update',
          targetId: String(lead._id),
          payload: updates,
        });
      }
    }

    const tokensUsed = raw.inputTokens + raw.outputTokens;
    const latencyMs = Date.now() - start;
    const confidence = await this.canHandle(ctx);

    return {
      agentName: this.name,
      promptVersion,
      confidence,
      outbound: { text: parsed.reply },
      outcome: 'pending',
      tokensUsed,
      costUsd: tokensUsed * COST_PER_TOKEN,
      latencyMs,
      sideEffects,
    };
  }

  async reflect(
    _ctx: AgentContext,
    result: AgentResult,
  ): Promise<string | null> {
    // Cheap self-critique: flag suspicious outputs for admin review. Real
    // semantic critique is a Phase 2 enhancement.
    const notes: string[] = [];
    if (result.outbound && result.outbound.text.length > 400) {
      notes.push('reply > 400 chars — may be too long for WhatsApp');
    }
    if (result.sideEffects.length === 0 && result.confidence > 0.7) {
      notes.push(
        'high confidence but no Lead updated — Lead may not exist yet',
      );
    }
    return notes.length > 0 ? notes.join('; ') : null;
  }

  private failed(
    ctx: AgentContext,
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
