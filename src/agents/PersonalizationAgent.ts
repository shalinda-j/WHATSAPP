import { z } from 'zod';
import { IAgent } from '../interfaces/IAgent';
import { AgentContext, AgentResult, AgentMode } from '../types/agent';
import { aiLoadBalancer } from '../services/AILoadBalancer';
import { Contact } from '../models/CRM';
import { PERSONALIZATION_V1_PROMPT } from './prompts/personalization-v1';
import { withOperatorPersona } from './composeSystemPrompt';

const GREETING_TOKENS = [
  'hi',
  'hello',
  'hey',
  'halo',
  'ayubowan',
  'ayubvan',
  'aaubowan',
  'vandanai',
  'vanakkam',
  'namaste',
  'namaskar',
  'kohomada',
  'kohomda',
  'sup',
  'good morning',
  'good evening',
  'gud',
];

const PersonalizationOutputSchema = z.object({
  reply: z.string().min(1).max(1000),
  extractedName: z.string().nullable(),
  extractedTags: z.array(z.string()).default([]),
  shouldHandoff: z.boolean(),
});
type PersonalizationOutput = z.infer<typeof PersonalizationOutputSchema>;

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

export class PersonalizationAgent implements IAgent {
  name = 'personalization';
  description =
    'Greets the user in their language using CRM context (returning user recognition, last topic). Extracts names and topic tags from introductions. Updates CRM lastContactedAt.';
  mode: AgentMode = 'disabled';

  async canHandle(ctx: AgentContext): Promise<number> {
    const text = ctx.inputMessage.toLowerCase().trim();
    if (text.length === 0) return 0;
    // Short messages with greeting tokens score high; long substantive
    // messages score low so LeadQualifier wins on real inquiries.
    let score = 0;
    for (const t of GREETING_TOKENS) {
      if (text.startsWith(t) || text.includes(` ${t}`)) {
        score += 0.3;
        break;
      }
    }
    if (text.length <= 30) score += 0.3;
    if (text.length <= 10) score += 0.2;
    return Math.min(score, 0.85);
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const promptVersion = ctx.assignedPrompt?.version ?? 1;
    const systemPrompt = await withOperatorPersona(
      ctx.assignedPrompt?.systemPrompt ?? PERSONALIZATION_V1_PROMPT,
    );

    const phone = phoneFromJid(ctx.userId);
    // Tenant-scope the contact lookup (legacy-tolerant). Without it a contact
    // with the same phone belonging to ANOTHER tenant can be matched and then
    // mutated (name/tags/lastContactedAt via updateOne below), leaking and
    // corrupting cross-tenant CRM data.
    const personalizationTenantId =
      typeof ctx.metadata?.tenantId === 'string' ? ctx.metadata.tenantId : null;
    const contactPhoneClause = {
      $or: [{ phone }, { whatsappNumber: phone }, { whatsappId: phone }],
    };
    const contact = await Contact.findOne(
      personalizationTenantId
        ? {
            $and: [
              contactPhoneClause,
              {
                $or: [
                  { tenantId: personalizationTenantId },
                  { tenantId: { $exists: false } },
                  { tenantId: null },
                ],
              },
            ],
          }
        : contactPhoneClause,
    );

    const crmContext = contact
      ? {
          name: contact.name || null,
          isReturning: true,
          lastContactedAt:
            contact.lastContactedAt || contact.lastContact || null,
          lastTopic:
            Array.isArray(contact.tags) && contact.tags.length
              ? contact.tags[contact.tags.length - 1]
              : null,
          tags: contact.tags || [],
        }
      : {
          name: null,
          isReturning: false,
          lastContactedAt: null,
          lastTopic: null,
          tags: [],
        };

    const augmentedInput = `${
      ctx.inputMessage
    }\n\n=== CRM_CONTEXT ===\n${JSON.stringify(
      crmContext,
    )}\n=== END_CRM_CONTEXT ===`;

    let raw;
    try {
      raw = await aiLoadBalancer.sendMessageRaw({
        systemPrompt,
        providerOverride: ctx.providerOverride,
        modelOverride: ctx.modelOverride,
        userMessage: augmentedInput,
        history: ctx.conversationHistory.slice(-6).map((m) => ({
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

    let parsed: PersonalizationOutput;
    try {
      const json = JSON.parse(stripJsonFences(raw.text));
      const validated = PersonalizationOutputSchema.safeParse(json);
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

    if (contact) {
      const updates: Record<string, unknown> = {
        lastContactedAt: new Date(),
        lastContact: new Date(),
      };
      if (parsed.extractedName && !contact.name?.trim()) {
        updates.name = parsed.extractedName;
      }
      if (parsed.extractedTags.length > 0) {
        const merged = Array.from(
          new Set([...(contact.tags || []), ...parsed.extractedTags]),
        ).slice(0, 30);
        updates.tags = merged;
      }
      await Contact.updateOne({ _id: contact._id }, { $set: updates });
      sideEffects.push({
        kind: 'crm.update',
        targetId: String(contact._id),
        payload: updates,
      });
    }
    // No new Contact creation here — Contact.name is required, and we should
    // not seed CRM with placeholder names. Contacts are created via the
    // existing registration flows where the name is captured explicitly.

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
