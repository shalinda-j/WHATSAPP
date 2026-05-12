import mongoose, { Schema, Document } from 'mongoose';

export interface IWorkflow extends Document {
  name: string;
  description?: string;
  nodes: any[];
  edges: any[];
  version: string;
  isActive: boolean;
  createdBy?: string;
  lastRunAt?: Date;
  runCount: number;
  metadata?: {
    tags?: string[];
    category?: string;
    isTemplate?: boolean;
  };
}

const WorkflowSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    nodes: [{ type: Schema.Types.Mixed, required: true }],
    edges: [{ type: Schema.Types.Mixed, required: true }],
    version: { type: String, default: '1.0.0' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String },
    lastRunAt: { type: Date },
    runCount: { type: Number, default: 0 },
    metadata: {
      tags: [{ type: String }],
      category: { type: String },
      isTemplate: { type: Boolean, default: false },
    },
  } as any,
  { timestamps: true },
);

export default mongoose.model(
  'Workflow',
  WorkflowSchema as any,
) as unknown as mongoose.Model<IWorkflow>;
