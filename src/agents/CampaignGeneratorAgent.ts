import { IAgent } from '../interfaces/IAgent';
import { AgentContext, AgentResult, AgentMode } from '../types/agent';
import { CAMPAIGN_GENERATOR_V1_PROMPT } from './prompts/campaign-generator-v1';

/**
 * CampaignGeneratorAgent — generates marketing campaign variants from a brief.
 *
 * This agent is NOT triggered by inbound customer messages — it's invoked
 * by the admin UI (POST /api/campaigns/:id/generate-variants) and runs
 * off the normal orchestrator path. canHandle() therefore returns 0 for
 * conversational input; the agent is exposed to the orchestrator only so
 * it benefits from the same prompt-version/budget/feedback machinery as
 * the conversational agents.
 *
 * Phase 2 implementation:
 *   1. Read campaign brief (audience, channels, goal, brand voice)
 *   2. Build CAMPAIGN_GENERATOR_V1_PROMPT context with those inputs
 *   3. Call aiLoadBalancer.sendMessageRaw()
 *   4. Validate JSON output against CampaignVariantsOutputSchema (zod)
 *   5. Return variants in result.outbound.text as JSON for the caller
 *      (orchestrator passes this through; it isn't sent to a user)
 *   6. Reflection: flag low-diversity variant sets, off-brand-voice copy
 */
export class CampaignGeneratorAgent implements IAgent {
  name = 'campaign_generator';
  description =
    'Generates A/B campaign copy variants (per-channel) from a brief — brand voice + audience + goal in, ready-to-send drafts out.';
  mode: AgentMode = 'disabled';

  async canHandle(_ctx: AgentContext): Promise<number> {
    // Operator-invoked only; never wins on conversational input.
    return 0;
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    void CAMPAIGN_GENERATOR_V1_PROMPT; // skeleton: prompt unused until Phase 2
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
      reflectionNote: 'CampaignGeneratorAgent skeleton — Phase 2 implements',
    };
  }
}
