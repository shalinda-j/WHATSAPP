import {
  AgentContext,
  AgentResult,
  AgentMode,
} from '../types/agent';

export interface IAgent {
  /**
   * Unique agent identifier — also the key in AgentConfig collection.
   * Example: 'lead_qualifier', 'deal_agent', 'social_reply'.
   */
  name: string;

  /**
   * Human-readable description shown in the admin dashboard.
   */
  description: string;

  /**
   * Current operational mode — read from Mongo AgentConfig, NOT hardcoded.
   * Orchestrator gates execution based on this:
   *   - autonomous → result.outbound is sent directly
   *   - approval   → result.outbound goes to AgentApprovalQueue first
   *   - disabled   → execute() is never called
   */
  mode: AgentMode;

  /**
   * Confidence score 0–1 that this agent should handle the given context.
   * Returned BEFORE incurring full execution cost so the orchestrator can
   * pick the best specialist (or none) cheaply.
   */
  canHandle(ctx: AgentContext): Promise<number>;

  /**
   * Run the agent. Must return a fully populated AgentResult — including
   * outcome, costs, latency, and any side effects performed.
   */
  execute(ctx: AgentContext): Promise<AgentResult>;

  /**
   * Optional self-critique step. Called by AgentReflectionService after
   * execute(). Agents that implement this can suggest prompt edits or
   * flag their own low-quality outputs. May be invoked async / fire-and-forget.
   */
  reflect?(ctx: AgentContext, result: AgentResult): Promise<string | null>;
}
