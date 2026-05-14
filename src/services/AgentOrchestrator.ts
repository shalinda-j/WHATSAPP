import { randomUUID } from 'crypto';
import { agentRegistry } from '../agents/AgentRegistry';
import { agentBudgetService } from './AgentBudgetService';
import { agentApprovalQueueService } from './AgentApprovalQueueService';
import AgentExecution from '../models/AgentExecution';
import AgentPromptVersion, {
  IAgentPromptVersion,
} from '../models/AgentPromptVersion';
import { IAgentConfig } from '../models/AgentConfig';
import {
  AgentContext,
  AgentContextSchema,
  AgentResult,
  AssignedPrompt,
} from '../types/agent';
import { IAgent } from '../interfaces/IAgent';

export interface OrchestratorOutcome {
  handled: boolean;
  outbound: string | null;
  queuedForApproval: boolean;
  agentName: string | null;
  traceId: string;
  reason?:
    | 'no_handler'
    | 'budget_per_conversation'
    | 'budget_daily_tokens'
    | 'budget_daily_cost'
    | 'agent_silent'
    | 'agent_error'
    | 'queued';
  result?: AgentResult;
}

export class AgentOrchestrator {
  /**
   * Main entry point. Caller (usually src/index.ts message handler) invokes
   * this between command dispatch and the legacy AI fallback. If `handled`
   * is false, caller should fall back to the existing AILoadBalancer.
   */
  async handle(rawCtx: Omit<AgentContext, 'traceId'> & { traceId?: string }):
    Promise<OrchestratorOutcome> {
    const traceId = rawCtx.traceId ?? randomUUID();
    const ctx = AgentContextSchema.parse({ ...rawCtx, traceId });

    const candidate = await agentRegistry.findBestAgent(ctx);
    if (!candidate) {
      return {
        handled: false,
        outbound: null,
        queuedForApproval: false,
        agentName: null,
        traceId,
        reason: 'no_handler',
      };
    }

    const { agent, config, confidence } = candidate;

    const budget = await agentBudgetService.check(
      config,
      ctx.sessionId,
      ctx.userId,
    );
    if (!budget.allowed) {
      await this.recordFailed(
        ctx,
        agent.name,
        config.currentPromptVersion,
        confidence,
        `Budget cap hit: ${budget.reason}`,
      );
      return {
        handled: true,
        outbound: null,
        queuedForApproval: false,
        agentName: agent.name,
        traceId,
        reason: this.budgetReasonToOutcome(budget.reason),
      };
    }

    const assigned = await this.pickPrompt(config);
    if (!assigned) {
      await this.recordFailed(
        ctx,
        agent.name,
        config.currentPromptVersion,
        confidence,
        'No prompt version found',
      );
      return {
        handled: true,
        outbound: null,
        queuedForApproval: false,
        agentName: agent.name,
        traceId,
        reason: 'agent_error',
      };
    }

    const ctxWithPrompt: AgentContext = {
      ...ctx,
      assignedPrompt: assigned,
    };

    const start = Date.now();
    let result: AgentResult;
    try {
      result = await agent.execute(ctxWithPrompt);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      await this.recordFailed(
        ctx,
        agent.name,
        assigned.version,
        confidence,
        err?.message ?? String(err),
        latencyMs,
      );
      return {
        handled: true,
        outbound: null,
        queuedForApproval: false,
        agentName: agent.name,
        traceId,
        reason: 'agent_error',
      };
    }

    // Persist execution record first — even queued/silent outcomes get a row
    // so the trace explorer always has every agent call visible.
    const executionDoc = await AgentExecution.create({
      traceId,
      agentName: agent.name,
      promptVersion: assigned.version,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      channel: ctx.channel,
      intent: (ctx.metadata?.intent as string) ?? null,
      input: ctx.inputMessage,
      output: result.outbound?.text ?? null,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      confidence: result.confidence,
      outcome: 'pending',
      sideEffects: result.sideEffects,
      reflectionNote: result.reflectionNote ?? null,
    });

    await Promise.all([
      agentBudgetService.record(
        agent.name,
        ctx.sessionId,
        ctx.userId,
        result.tokensUsed,
        result.costUsd,
      ),
      AgentPromptVersion.updateOne(
        { agentName: agent.name, version: assigned.version },
        {
          $inc: {
            'metrics.uses': 1,
            'metrics.totalLatencyMs': result.latencyMs,
            'metrics.totalTokens': result.tokensUsed,
            'metrics.totalCostUsd': result.costUsd,
          },
          $set: { 'metrics.lastUsedAt': new Date() },
        },
      ),
    ]);

    if (!result.outbound) {
      await AgentExecution.updateOne(
        { _id: executionDoc._id },
        { $set: { outcome: 'success' } },
      );
      this.fireReflection(agent, ctxWithPrompt, result, executionDoc._id);
      return {
        handled: true,
        outbound: null,
        queuedForApproval: false,
        agentName: agent.name,
        traceId,
        reason: 'agent_silent',
        result,
      };
    }

    if (config.mode === 'approval') {
      await agentApprovalQueueService.enqueue({
        executionId: executionDoc._id as any,
        traceId,
        agentName: agent.name,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        channel: ctx.channel,
        proposedMessage: result.outbound.text,
      });
      await AgentExecution.updateOne(
        { _id: executionDoc._id },
        { $set: { outcome: 'queued_for_approval' } },
      );
      this.fireReflection(agent, ctxWithPrompt, result, executionDoc._id);
      return {
        handled: true,
        outbound: null,
        queuedForApproval: true,
        agentName: agent.name,
        traceId,
        reason: 'queued',
        result,
      };
    }

    // autonomous
    await AgentExecution.updateOne(
      { _id: executionDoc._id },
      { $set: { outcome: 'success' } },
    );
    await AgentPromptVersion.updateOne(
      { agentName: agent.name, version: assigned.version },
      { $inc: { 'metrics.successes': 1 } },
    );

    this.fireReflection(agent, ctxWithPrompt, result, executionDoc._id);

    return {
      handled: true,
      outbound: result.outbound.text,
      queuedForApproval: false,
      agentName: agent.name,
      traceId,
      result,
    };
  }

  private async pickPrompt(
    config: IAgentConfig,
  ): Promise<AssignedPrompt | null> {
    const useCandidate =
      config.candidatePromptVersion != null &&
      Math.random() * 100 < (config.candidateTrafficPercent ?? 0);

    const targetVersion = useCandidate
      ? config.candidatePromptVersion!
      : config.currentPromptVersion;

    const prompt: IAgentPromptVersion | null = await AgentPromptVersion.findOne(
      { agentName: config.name, version: targetVersion },
    );
    if (!prompt) return null;

    return {
      version: prompt.version,
      systemPrompt: prompt.systemPrompt,
      isCandidate: useCandidate,
    };
  }

  private async recordFailed(
    ctx: AgentContext,
    agentName: string,
    promptVersion: number,
    confidence: number,
    errorMessage: string,
    latencyMs = 0,
  ): Promise<void> {
    try {
      await AgentExecution.create({
        traceId: ctx.traceId,
        agentName,
        promptVersion,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        channel: ctx.channel,
        input: ctx.inputMessage,
        output: null,
        confidence,
        latencyMs,
        outcome: 'failed',
        errorMessage,
      });
      await AgentPromptVersion.updateOne(
        { agentName, version: promptVersion },
        { $inc: { 'metrics.failures': 1 } },
      );
    } catch (err) {
      console.error('AgentOrchestrator: failed to record failure', err);
    }
  }

  private budgetReasonToOutcome(
    r: 'per_conversation_cap' | 'daily_token_cap' | 'daily_cost_cap' | undefined,
  ): OrchestratorOutcome['reason'] {
    if (r === 'per_conversation_cap') return 'budget_per_conversation';
    if (r === 'daily_token_cap') return 'budget_daily_tokens';
    if (r === 'daily_cost_cap') return 'budget_daily_cost';
    return 'agent_error';
  }

  private fireReflection(
    agent: IAgent,
    ctx: AgentContext,
    result: AgentResult,
    executionId: unknown,
  ): void {
    if (!agent.reflect) return;
    // Fire-and-forget — reflection must never block the response path.
    agent
      .reflect(ctx, result)
      .then(async (note) => {
        if (!note) return;
        await AgentExecution.updateOne(
          { _id: executionId as any },
          { $set: { reflectionNote: note } },
        );
      })
      .catch((err) =>
        console.error(`Reflection failed for ${agent.name}:`, err),
      );
  }
}

export const agentOrchestrator = new AgentOrchestrator();
