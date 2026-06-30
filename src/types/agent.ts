import { z } from 'zod';

export const AgentModeSchema = z.enum(['autonomous', 'approval', 'disabled']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const ChannelSchema = z.enum([
  'whatsapp',
  'telegram',
  'instagram',
  'facebook',
  'linkedin',
  'tiktok',
  'twitter',
  'youtube',
  'email',
  'web',
]);
export type Channel = z.infer<typeof ChannelSchema>;

export const IntentSchema = z.enum([
  'greeting',
  'lead_inquiry',
  'job_search',
  'pricing_question',
  'product_question',
  'support_request',
  'complaint',
  'booking_request',
  'feedback',
  'spam',
  'unknown',
]);
export type Intent = z.infer<typeof IntentSchema>;

export const OutcomeSchema = z.enum([
  'pending',
  'success',
  'failed',
  'queued_for_approval',
  'rejected_by_admin',
  'no_handler',
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const FeedbackSourceSchema = z.enum([
  'admin_manual',
  'admin_approval_reject',
  'admin_approval_edit',
  'outcome_lead_status',
  'outcome_booking_created',
  'outcome_booking_cancelled',
  'reflection_auto',
]);
export type FeedbackSource = z.infer<typeof FeedbackSourceSchema>;

// LLM-extracted BANT signals — every field optional because hallucination must not
// inject false data; agents fill only what they can defend from the conversation.
export const BANTSignalSchema = z.object({
  budget: z
    .object({
      amount: z.number().nullable().optional(),
      currency: z.string().nullable().optional(),
      confidence: z.number().min(0).max(1),
      evidence: z.string().min(1),
    })
    .optional(),
  authority: z
    .object({
      isDecisionMaker: z.boolean().nullable(),
      role: z.string().nullable().optional(),
      confidence: z.number().min(0).max(1),
      evidence: z.string().min(1),
    })
    .optional(),
  need: z
    .object({
      summary: z.string().min(1),
      urgency: z.enum(['low', 'medium', 'high']).nullable().optional(),
      confidence: z.number().min(0).max(1),
      evidence: z.string().min(1),
    })
    .optional(),
  timing: z
    .object({
      timeframe: z.string().nullable().optional(),
      confidence: z.number().min(0).max(1),
      evidence: z.string().min(1),
    })
    .optional(),
  overallScore: z.number().min(0).max(1),
});
export type BANTSignal = z.infer<typeof BANTSignalSchema>;

export const AssignedPromptSchema = z.object({
  version: z.number().int().min(1),
  systemPrompt: z.string(),
  isCandidate: z.boolean().default(false),
});
export type AssignedPrompt = z.infer<typeof AssignedPromptSchema>;

export const AgentContextSchema = z.object({
  traceId: z.string(),
  sessionId: z.string(),
  userId: z.string(),
  channel: ChannelSchema,
  language: z.string().default('si'),
  inputMessage: z.string(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.date().optional(),
      }),
    )
    .default([]),
  // Populated by the Orchestrator before execute() based on A/B selection;
  // canHandle() runs without this since scoring should be cheap and prompt-independent.
  assignedPrompt: AssignedPromptSchema.optional(),
  // Per-channel-account agent allowlist. Loaded by the caller from
  // ChannelConnection.agentBindings before invoking the orchestrator.
  // Empty/undefined = every registered agent eligible (legacy default).
  agentBindings: z.array(z.string()).optional(),
  // Per-agent AI provider/model pin from AgentConfig. The orchestrator copies
  // these in before execute() so agents can forward them to
  // aiLoadBalancer.sendMessageRaw — otherwise an operator who pins a provider
  // for an agent in the admin UI was silently ignored.
  providerOverride: z.string().nullish(),
  modelOverride: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AgentContext = z.infer<typeof AgentContextSchema>;

export const AgentResultSchema = z.object({
  agentName: z.string(),
  promptVersion: z.number().int().min(1),
  // confidence the agent should have handled this message at all
  confidence: z.number().min(0).max(1),
  // outbound payload — null if agent decided silence is correct
  outbound: z
    .object({
      text: z.string(),
      mediaUrl: z.string().url().optional(),
      delayMs: z.number().int().min(0).optional(),
    })
    .nullable(),
  outcome: OutcomeSchema,
  tokensUsed: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  latencyMs: z.number().int().min(0),
  // structured side effects — agents must declare what they wrote so audit/rollback is possible
  sideEffects: z
    .array(
      z.object({
        kind: z.enum([
          'lead.create',
          'lead.update',
          'booking.create',
          'booking.update',
          'crm.update',
          'memory.write',
          'webhook.fire',
        ]),
        targetId: z.string().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .default([]),
  reflectionNote: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

// Routing decision returned by the Orchestrator's router step. Kept separate
// from AgentResult so the router can choose multiple specialists or skip.
export const RoutingDecisionSchema = z.object({
  primaryAgent: z.string().nullable(),
  intent: IntentSchema,
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
