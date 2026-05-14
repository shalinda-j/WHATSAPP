import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentFeedback extends Document {
  executionId: mongoose.Types.ObjectId;
  agentName: string;
  promptVersion: number;
  source:
    | 'admin_manual'
    | 'admin_approval_reject'
    | 'admin_approval_edit'
    | 'outcome_lead_status'
    | 'outcome_booking_created'
    | 'outcome_booking_cancelled'
    | 'reflection_auto';
  score: -1 | 0 | 1;
  note: string | null;
  linkedLeadId: mongoose.Types.ObjectId | null;
  linkedBookingId: mongoose.Types.ObjectId | null;
  createdBy: string | null;
  diffPayload: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const AgentFeedbackSchema = new Schema(
  {
    executionId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentExecution',
      required: true,
      index: true,
    },
    agentName: { type: String, required: true, index: true },
    promptVersion: { type: Number, required: true },
    source: {
      type: String,
      enum: [
        'admin_manual',
        'admin_approval_reject',
        'admin_approval_edit',
        'outcome_lead_status',
        'outcome_booking_created',
        'outcome_booking_cancelled',
        'reflection_auto',
      ],
      required: true,
      index: true,
    },
    score: { type: Number, enum: [-1, 0, 1], required: true },
    note: { type: String, default: null },
    linkedLeadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    linkedBookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    createdBy: { type: String, default: null },
    diffPayload: { type: Schema.Types.Mixed, default: null },
  } as any,
  { timestamps: true },
);

AgentFeedbackSchema.index({ agentName: 1, promptVersion: 1, score: 1 });
AgentFeedbackSchema.index({ agentName: 1, createdAt: -1 });

export default mongoose.model(
  'AgentFeedback',
  AgentFeedbackSchema as any,
) as unknown as mongoose.Model<IAgentFeedback>;
