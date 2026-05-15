import mongoose, { Schema, Document } from 'mongoose';

export interface ISegmentRule {
  /** Field path to evaluate — supports dotted paths like 'lead.status'. */
  field: string;
  operator:
    | 'eq'
    | 'ne'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in'
    | 'nin'
    | 'contains'
    | 'exists';
  value: unknown;
}

export interface IContactSegment extends Document {
  tenantId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  /** Either author rules manually OR have SegmentationAgent generate them. */
  authoredBy: 'human' | 'segmentation_agent';
  /** Rules are AND-ed; complex OR logic uses nested groups via the `or` array. */
  rules: ISegmentRule[];
  or?: ISegmentRule[][];
  /** Last computed size — refreshed by SegmentationService.recompute(). */
  memberCount: number;
  lastComputedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RuleSchema = new Schema(
  {
    field: { type: String, required: true },
    operator: { type: String, required: true },
    value: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const ContactSegmentSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String },
    authoredBy: {
      type: String,
      enum: ['human', 'segmentation_agent'],
      default: 'human',
    },
    rules: [RuleSchema],
    or: [[RuleSchema]],
    memberCount: { type: Number, default: 0 },
    lastComputedAt: { type: Date },
  } as any,
  { timestamps: true },
);

ContactSegmentSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export default mongoose.model(
  'ContactSegment',
  ContactSegmentSchema as any,
) as unknown as mongoose.Model<IContactSegment>;
