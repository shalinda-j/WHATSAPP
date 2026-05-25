import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentConfig extends Document {
  name: string;
  description: string;
  mode: 'autonomous' | 'approval' | 'disabled';
  currentPromptVersion: number;
  candidatePromptVersion: number | null;
  candidateTrafficPercent: number;
  modelOverride: string | null;
  providerOverride: string | null;
  budgetTokensPerConversation: number;
  budgetTokensPerDay: number;
  costCapUsdPerDay: number;
  confidenceThreshold: number;
  maxStepsPerMessage: number;
  isActive: boolean;
  // Promotion policy — when nightly evolver finishes A/B, what to do
  // 'auto'   — auto-promote winning candidate
  // 'manual' — require admin approval to promote
  promotionPolicy: 'auto' | 'manual';
  autoPromoteMinSamples: number;
  autoPromoteMinPValue: number;
  createdAt: Date;
  updatedAt: Date;
}

const AgentConfigSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: '' },
    mode: {
      type: String,
      enum: ['autonomous', 'approval', 'disabled'],
      default: 'approval',
      index: true,
    },
    currentPromptVersion: { type: Number, default: 1 },
    candidatePromptVersion: { type: Number, default: null },
    candidateTrafficPercent: { type: Number, default: 10, min: 0, max: 100 },
    modelOverride: { type: String, default: null },
    providerOverride: { type: String, default: null },
    budgetTokensPerConversation: { type: Number, default: 8000 },
    budgetTokensPerDay: { type: Number, default: 2_000_000 },
    costCapUsdPerDay: { type: Number, default: 50 },
    confidenceThreshold: { type: Number, default: 0.5, min: 0, max: 1 },
    maxStepsPerMessage: { type: Number, default: 1, min: 1, max: 5 },
    isActive: { type: Boolean, default: true, index: true },
    promotionPolicy: {
      type: String,
      enum: ['auto', 'manual'],
      default: 'manual',
    },
    autoPromoteMinSamples: { type: Number, default: 50 },
    autoPromoteMinPValue: { type: Number, default: 0.05 },
  } as any,
  { timestamps: true },
);

const __AgentConfigModel =
  mongoose.models.AgentConfig ||
  mongoose.model('AgentConfig', AgentConfigSchema as any);
export default __AgentConfigModel as unknown as mongoose.Model<IAgentConfig>;
