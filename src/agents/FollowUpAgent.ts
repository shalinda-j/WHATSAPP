import { IAgent } from '../interfaces/IAgent';
import { AgentContext, AgentResult, AgentMode } from '../types/agent';
import { FOLLOWUP_V1_PROMPT } from './prompts/followup-v1';

/**
 * FollowUpAgent — re-engages dormant or stalled leads with a warm,
 * low-pressure message that gives a concrete reason to reply.
 *
 * Invocation: cron-driven, NOT inbound-driven. A scheduled worker
 * (FollowUpScheduler — Phase 3) queries Leads with status ∈ {'new',
 * 'reviewed'} and lastInteractionAt > 5 days ago, then calls this
 * agent for each batch.
 *
 * The agent decides per-contact whether to send (shouldFollowUp),
 * what channel to use, and when to next re-evaluate (nextCheckInDays).
 *
 * Phase 2 implementation:
 *   1. Build CONTACT_PROFILE + LEAD_CONTEXT + LAST_INTERACTION inputs
 *      from the Lead/Contact/ChatMessage collections
 *   2. Run FOLLOWUP_V1_PROMPT
 *   3. Validate output, persist a FollowUpRecord row, and (if
 *      shouldFollowUp) enqueue an OutboundMessage via the channel
 *      router — with the same approval-queue gate as other agents.
 */
export class FollowUpAgent implements IAgent {
  name = 'follow_up';
  description =
    'Drafts personalised re-engagement messages for dormant leads — decides whether to follow up, on which channel, and when to next check in.';
  mode: AgentMode = 'disabled';

  async canHandle(_ctx: AgentContext): Promise<number> {
    // Cron-invoked; conversational score stays 0.
    return 0;
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    void FOLLOWUP_V1_PROMPT;
    return {
      agentName: this.name,
      promptVersion: ctx.assignedPrompt?.version ?? 1,
      confidence: 0,
      outbound: null,
      outcome: 'failed',
      tokensUsed: 0,
      costUsd: 0,
      latencyMs: 0,
      sideEffects: [],
      reflectionNote: 'FollowUpAgent skeleton — Phase 2 implements',
    };
  }
}
