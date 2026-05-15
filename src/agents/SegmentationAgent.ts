import { IAgent } from '../interfaces/IAgent';
import { AgentContext, AgentResult, AgentMode } from '../types/agent';
import { SEGMENTATION_V1_PROMPT } from './prompts/segmentation-v1';

/**
 * SegmentationAgent — translates a natural-language segment description
 * into a structured rule set the SegmentationService rule engine can
 * compile to MongoDB filters.
 *
 * Operator-invoked only: admin UI (POST /api/segments/from-description)
 * forwards the user's wish to this agent. The agent returns a draft
 * segment definition that the admin can review and save.
 *
 * Phase 2 implementation:
 *   1. Pull AVAILABLE_FIELDS from a manifest (Contact + Lead schema
 *      introspection cached per-tenant)
 *   2. Run prompt with description + manifest
 *   3. Validate against SegmentDraftOutputSchema with field path allowlist
 *   4. Pre-compute estimatedSize via a sample aggregation so the admin
 *      can see the segment is non-empty before saving.
 */
export class SegmentationAgent implements IAgent {
  name = 'segmentation';
  description =
    'Translates natural-language segment descriptions ("dormant Japan-job leads from the last 30 days") into rule-engine-ready filter definitions.';
  mode: AgentMode = 'disabled';

  async canHandle(_ctx: AgentContext): Promise<number> {
    return 0;
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    void SEGMENTATION_V1_PROMPT;
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
      reflectionNote: 'SegmentationAgent skeleton — Phase 2 implements',
    };
  }
}
