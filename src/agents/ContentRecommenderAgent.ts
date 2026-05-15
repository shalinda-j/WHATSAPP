import { IAgent } from '../interfaces/IAgent';
import { AgentContext, AgentResult, AgentMode } from '../types/agent';
import { CONTENT_RECOMMENDER_V1_PROMPT } from './prompts/content-recommender-v1';

/**
 * ContentRecommenderAgent — picks the next-best content asset to send to
 * a specific contact based on lifecycle stage, tags, and recent sends.
 *
 * Invoked via two entry points:
 *   1. Inbound flow: when the IntentClassifier tags a message as
 *      'product_question' or 'support_request', this agent can score high
 *      and propose a content nudge inline with the human reply.
 *   2. Campaign flow: CampaignService.tickSender() can call this agent
 *      per-recipient to personalise variant selection beyond random
 *      weighted A/B.
 *
 * Phase 2 implementation:
 *   - Pull Contact + ContentLibrary docs scoped to tenantId
 *   - Build CONTENT_RECOMMENDER_V1_PROMPT context
 *   - Validate output against zod schema with content id allowlist
 *   - Never invent contentIds — schema enforces .refine() against the
 *     allowlist passed into the prompt
 */
export class ContentRecommenderAgent implements IAgent {
  name = 'content_recommender';
  description =
    'Recommends the next-best content asset (article, video, offer) for a contact based on their profile and engagement history.';
  mode: AgentMode = 'disabled';

  async canHandle(_ctx: AgentContext): Promise<number> {
    // Phase 2: score >= 0.4 when intent ∈ {'product_question', 'feedback'}
    return 0;
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    void CONTENT_RECOMMENDER_V1_PROMPT;
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
      reflectionNote: 'ContentRecommenderAgent skeleton — Phase 2 implements',
    };
  }
}
