import AgentBudgetLedger from '../models/AgentBudgetLedger';
import { IAgentConfig } from '../models/AgentConfig';

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
      return {
        allowed: false,
        reason: 'per_conversation_cap',
        conversationTokensUsed,
        dailyTokensUsed,
        dailyCostUsd,
      };
    }
    if (dailyTokensUsed >= config.budgetTokensPerDay) {
      return {
        allowed: false,
        reason: 'daily_token_cap',
        conversationTokensUsed,
        dailyTokensUsed,
        dailyCostUsd,
      };
    }
    if (dailyCostUsd >= config.costCapUsdPerDay) {
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
