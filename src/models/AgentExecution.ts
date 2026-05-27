import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentSideEffect {
  kind:
    | 'lead.create'
    | 'lead.update'
    | 'booking.create'
    | 'booking.update'
    | 'crm.update'
    | 'memory.write'
    | 'webhook.fire';
  targetId?: string;
  payload?: Record<string, unknown>;
}

export interface IAgentExecution extends Document {
  traceId: string;
  agentName: string;
  promptVersion: number;
  userId: string;
  sessionId: string;
  channel: string;
  intent: string | null;
  input: string;
  output: string | null;
  tokensUsed: number;
  costUsd: number;
  latencyMs: number;
  confidence: number;
  outcome:
    | 'pending'
    | 'success'
    | 'failed'
    | 'queued_for_approval'
    | 'rejected_by_admin'
    | 'no_handler';
  sideEffects: IAgentSideEffect[];
  reflectionNote: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SideEffectSchema = new Schema(
  {
    kind: {
      type: String,
      enum: [
        'lead.create',
        'lead.update',
        'booking.create',
        'booking.update',
        'crm.update',
        'memory.write',
        'webhook.fire',
      ],
      required: true,
    },
    targetId: { type: String },
    payload: { type: Schema.Types.Mixed },
  } as any,
  { _id: false },
);

const AgentExecutionSchema = new Schema(
  {
    traceId: { type: String, required: true, unique: true, index: true },
    agentName: { type: String, required: true, index: true },
    promptVersion: { type: Number, required: true },
    userId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    channel: { type: String, default: 'whatsapp', index: true },
    intent: { type: String, default: null, index: true },
    input: { type: String, required: true },
    output: { type: String, default: null },
    tokensUsed: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    confidence: { type: Number, default: 0 },
    outcome: {
      type: String,
      enum: [
        'pending',
        'success',
        'failed',
        'queued_for_approval',
        'rejected_by_admin',
        'no_handler',
      ],
      default: 'pending',
      index: true,
    },
    sideEffects: { type: [SideEffectSchema], default: [] },
    reflectionNote: { type: String, default: null },
    errorMessage: { type: String, default: null },
  } as any,
  { timestamps: true },
);

AgentExecutionSchema.index({ agentName: 1, createdAt: -1 });
AgentExecutionSchema.index({ userId: 1, createdAt: -1 });
AgentExecutionSchema.index({ sessionId: 1, createdAt: -1 });
// 90-day retention — TTL on createdAt avoids unbounded growth of trace data
AgentExecutionSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);

const __AgentExecutionModel =
  mongoose.models.AgentExecution ||
  mongoose.model('AgentExecution', AgentExecutionSchema as any);
export default __AgentExecutionModel as unknown as mongoose.Model<IAgentExecution>;
