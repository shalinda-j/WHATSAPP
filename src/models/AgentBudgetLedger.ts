import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentBudgetLedger extends Document {
  agentName: string;
  conversationId: string;
  date: Date;
  tokensUsed: number;
  costUsd: number;
  executions: number;
  createdAt: Date;
  updatedAt: Date;
}

const AgentBudgetLedgerSchema = new Schema(
  {
    agentName: { type: String, required: true, index: true },
    // conversationId is normalized as `${sessionId}::${userId}` so per-user
    // and per-session caps both query the same field.
    conversationId: { type: String, required: true, index: true },
    // Date is truncated to day (UTC midnight) for daily aggregation
    date: { type: Date, required: true, index: true },
    tokensUsed: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    executions: { type: Number, default: 0 },
  } as any,
  { timestamps: true },
);

AgentBudgetLedgerSchema.index(
  { agentName: 1, conversationId: 1, date: 1 },
  { unique: true },
);
AgentBudgetLedgerSchema.index({ agentName: 1, date: -1 });
// 180-day ledger retention for analytics
AgentBudgetLedgerSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 180 },
);

export default mongoose.model(
  'AgentBudgetLedger',
  AgentBudgetLedgerSchema as any,
) as unknown as mongoose.Model<IAgentBudgetLedger>;
