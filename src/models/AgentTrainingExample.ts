import mongoose, { Schema, Document } from 'mongoose';

export type TrainingExampleSource = 'manual' | 'harvested';

export interface IAgentTrainingExample extends Document {
  tenantId: mongoose.Types.ObjectId;
  agentName: string;
  /** What the user said / situation the agent will face. */
  input: string;
  /** Ideal agent response — used both as RAG context and as ground truth for eval. */
  expectedOutput: string;
  /** Operator-defined labels — e.g. ['pricing', 'objection', 'first-touch']. */
  tags: string[];
  source: TrainingExampleSource;
  /** Optional pointer back to AgentExecution / Lead / Booking when harvested. */
  sourceRef?: string;
  /** Cached embedding for cosine similarity lookup. */
  embedding?: number[];
  embeddingModel?: string;
  embeddedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AgentTrainingExampleSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    agentName: { type: String, required: true, index: true },
    input: { type: String, required: true },
    expectedOutput: { type: String, required: true },
    tags: { type: [String], default: [] },
    source: {
      type: String,
      enum: ['manual', 'harvested'],
      default: 'manual',
      index: true,
    },
    sourceRef: { type: String },
    embedding: { type: [Number] },
    embeddingModel: { type: String },
    embeddedAt: { type: Date },
    isActive: { type: Boolean, default: true, index: true },
  } as any,
  { timestamps: true },
);

AgentTrainingExampleSchema.index({ tenantId: 1, agentName: 1, isActive: 1 });

const __AgentTrainingExampleModel = mongoose.models.AgentTrainingExample || mongoose.model('AgentTrainingExample', AgentTrainingExampleSchema as any);
export default __AgentTrainingExampleModel as unknown as mongoose.Model<IAgentTrainingExample>;
