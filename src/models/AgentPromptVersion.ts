import mongoose, { Schema, Document } from 'mongoose';

export interface IPromptMetrics {
  uses: number;
  successes: number;
  failures: number;
  queuedApprovals: number;
  approvalRejects: number;
  totalLatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
  // Outcome correlations — populated by AgentReflectionService over time
  positiveFeedback: number;
  negativeFeedback: number;
  lastUsedAt: Date | null;
}

export interface IAgentPromptVersion extends Document {
  agentName: string;
  version: number;
  systemPrompt: string;
  toolSchemaJson: string | null;
  changelog: string;
  createdBy: string;
  metrics: IPromptMetrics;
  isCurrent: boolean;
  isCandidate: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PromptMetricsSchema = new Schema(
  {
    uses: { type: Number, default: 0 },
    successes: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    queuedApprovals: { type: Number, default: 0 },
    approvalRejects: { type: Number, default: 0 },
    totalLatencyMs: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    totalCostUsd: { type: Number, default: 0 },
    positiveFeedback: { type: Number, default: 0 },
    negativeFeedback: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
  } as any,
  { _id: false },
);

const AgentPromptVersionSchema = new Schema(
  {
    agentName: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    systemPrompt: { type: String, required: true },
    toolSchemaJson: { type: String, default: null },
    changelog: { type: String, default: '' },
    createdBy: { type: String, default: 'system' },
    metrics: { type: PromptMetricsSchema, default: () => ({}) },
    isCurrent: { type: Boolean, default: false, index: true },
    isCandidate: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
  } as any,
  { timestamps: true },
);

AgentPromptVersionSchema.index({ agentName: 1, version: -1 }, { unique: true });
AgentPromptVersionSchema.index({ agentName: 1, isCurrent: 1 });
AgentPromptVersionSchema.index({ agentName: 1, isCandidate: 1 });

const __AgentPromptVersionModel =
  mongoose.models.AgentPromptVersion ||
  mongoose.model('AgentPromptVersion', AgentPromptVersionSchema as any);
export default __AgentPromptVersionModel as unknown as mongoose.Model<IAgentPromptVersion>;
