import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentApprovalQueue extends Document {
  executionId: mongoose.Types.ObjectId;
  traceId: string;
  agentName: string;
  userId: string;
  sessionId: string;
  channel: string;
  proposedMessage: string;
  editedMessage: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'edited' | 'expired' | 'sent';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewerNotes: string | null;
  // Auto-expire pending approvals — operator review must happen fast or the
  // outbound message becomes stale relative to the user's conversation.
  expiresAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AgentApprovalQueueSchema = new Schema(
  {
    executionId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentExecution',
      required: true,
      unique: true,
      index: true,
    },
    traceId: { type: String, required: true, index: true },
    agentName: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true },
    channel: { type: String, default: 'whatsapp', index: true },
    proposedMessage: { type: String, required: true },
    editedMessage: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'edited', 'expired', 'sent'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    reviewerNotes: { type: String, default: null },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 1000 * 60 * 60 * 4),
    },
    sentAt: { type: Date, default: null },
  } as any,
  { timestamps: true },
);

AgentApprovalQueueSchema.index({ status: 1, createdAt: -1 });
AgentApprovalQueueSchema.index({ agentName: 1, status: 1 });
AgentApprovalQueueSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const __AgentApprovalQueueModel = mongoose.models.AgentApprovalQueue || mongoose.model('AgentApprovalQueue', AgentApprovalQueueSchema as any);
export default __AgentApprovalQueueModel as unknown as mongoose.Model<IAgentApprovalQueue>;
