import AgentBudgetLedger from '../models/AgentBudgetLedger';
import { IAgentConfig } from '../models/AgentConfig';
import { WebhookService } from './WebhookService';

const BUDGET_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const lastAlertByAgentReason = new Map<string, number>();

export interface BudgetCheck {
  allowed: boolean;
  reason?: 'per_conversation_cap' | 'daily_token_cap' | 'daily_cost_cap';
  conversationTokensUsed: number;
  dailyTokensUsed: number;
  dailyCostUsd: number;
}

function dayStart(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function conversationKey(sessionId: string, userId: string): string {
  return `${sessionId}::${userId}`;
}

export class AgentBudgetService {
  /**
   * Check whether an agent execution is within all configured budgets.
   * Aggregates today's spend (per conversation + per agent global) and
   * compares against config caps. Always returns counters even when allowed
   * so the orchestrator can surface near-cap warnings to the admin UI.
   */
  async check(
    config: IAgentConfig,
    sessionId: string,
    userId: string,
  ): Promise<BudgetCheck> {
    const today = dayStart();
    const convKey = conversationKey(sessionId, userId);

    const [convRow, dailyAgg] = await Promise.all([
      AgentBudgetLedger.findOne({
        agentName: config.name,
        conversationId: convKey,
        date: today,
      }),
      AgentBudgetLedger.aggregate([
        { $match: { agentName: config.name, date: today } },
        {
          $group: {
            _id: null,
            tokens: { $sum: '$tokensUsed' },
            cost: { $sum: '$costUsd' },
          },
        },
      ]),
    ]);

    const conversationTokensUsed = convRow?.tokensUsed ?? 0;
    const dailyTokensUsed = dailyAgg[0]?.tokens ?? 0;
    const dailyCostUsd = dailyAgg[0]?.cost ?? 0;

    if (conversationTokensUsed >= config.budgetTokensPerConversation) {
      this.emitBudgetAlert(config, 'per_conversation_cap', {
        conversationTokensUsed,
        dailyTokensUsed,
        dailyCostUsd,
      });
      return {
        allowed: false,
        reason: 'per_conversation_cap',
        conversationTokensUsed,
        dailyTokensUsed,
        dailyCostUsd,
      };
    }
    if (dailyTokensUsed >= config.budgetTokensPerDay) {
      this.emitBudgetAlert(config, 'daily_token_cap', {
        conversationTokensUsed,
        dailyTokensUsed,
        dailyCostUsd,
      });
      return {
        allowed: false,
        reason: 'daily_token_cap',
        conversationTokensUsed,
        dailyTokensUsed,
        dailyCostUsd,
      };
    }
    if (dailyCostUsd >= config.costCapUsdPerDay) {
      this.emitBudgetAlert(config, 'daily_cost_cap', {
        conversationTokensUsed,
        dailyTokensUsed,
        dailyCostUsd,
      });
      return {
        allowed: false,
        reason: 'daily_cost_cap',
        conversationTokensUsed,
        dailyTokensUsed,
        dailyCostUsd,
      };
    }

    return {
      allowed: true,
      conversationTokensUsed,
      dailyTokensUsed,
      dailyCostUsd,
    };
  }

  /**
   * Fires an ops webhook alert when an agent trips a budget cap. Cooldown
   * keyed by (agent, reason) so a runaway conversation can't flood ops
   * with one alert per blocked execution. Fire-and-forget — never blocks
   * the budget check.
   */
  private emitBudgetAlert(
    config: IAgentConfig,
    reason: 'per_conversation_cap' | 'daily_token_cap' | 'daily_cost_cap',
    counters: {
      conversationTokensUsed: number;
      dailyTokensUsed: number;
      dailyCostUsd: number;
    },
  ): void {
    const key = `${config.name}::${reason}`;
    const last = lastAlertByAgentReason.get(key) ?? 0;
    if (Date.now() - last < BUDGET_ALERT_COOLDOWN_MS) return;
    lastAlertByAgentReason.set(key, Date.now());

    const REASON_BODY: Record<typeof reason, string> = {
      per_conversation_cap:
        'A single conversation has consumed its allowed token budget.',
      daily_token_cap:
        'The agent has hit the daily token cap and is blocked until the next reset.',
      daily_cost_cap:
        'The agent has hit the daily USD cost cap and is blocked until the next reset.',
    };

    void WebhookService.triggerOpsAlert({
      level: reason === 'daily_cost_cap' ? 'error' : 'warn',
      title: `Agent budget cap hit: ${config.name}`,
      body: REASON_BODY[reason],
      fields: {
        agent: config.name,
        reason,
        conversationTokens: counters.conversationTokensUsed,
        dailyTokens: counters.dailyTokensUsed,
        dailyCostUsd: counters.dailyCostUsd.toFixed(4),
      },
    });
  }

  async record(
    agentName: string,
    sessionId: string,
    userId: string,
    tokensUsed: number,
    costUsd: number,
  ): Promise<void> {
    const today = dayStart();
    const convKey = conversationKey(sessionId, userId);
    await AgentBudgetLedger.updateOne(
      { agentName, conversationId: convKey, date: today },
      {
        $inc: {
          tokensUsed,
          costUsd,
          executions: 1,
        },
        $setOnInsert: { agentName, conversationId: convKey, date: today },
      },
      { upsert: true },
    );
  }

  async todayStats(agentName: string): Promise<{
    tokens: number;
    costUsd: number;
    executions: number;
    conversations: number;
  }> {
    const today = dayStart();
    const [agg] = await AgentBudgetLedger.aggregate([
      { $match: { agentName, date: today } },
      {
        $group: {
          _id: null,
          tokens: { $sum: '$tokensUsed' },
          costUsd: { $sum: '$costUsd' },
          executions: { $sum: '$executions' },
          conversations: { $sum: 1 },
        },
      },
    ]);
    return {
      tokens: agg?.tokens ?? 0,
      costUsd: agg?.costUsd ?? 0,
      executions: agg?.executions ?? 0,
      conversations: agg?.conversations ?? 0,
    };
  }
}

export const agentBudgetService = new AgentBudgetService();
