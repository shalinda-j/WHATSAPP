import mongoose, { Schema, Document } from 'mongoose';

export type AssetType = 'image' | 'video' | 'audio';
export type AssetStatus = 'pending' | 'ready' | 'failed';

export interface IGeneratedAsset extends Document {
  tenantId: mongoose.Types.ObjectId;
  type: AssetType;
  provider: string;
  modelName?: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  url?: string;
  /** Base64 fallback when the provider doesn't host the asset. */
  inlineBase64?: string;
  status: AssetStatus;
  errorMessage?: string;
  costUsd?: number;
  /** Free-form provider response details for debugging / future revisions. */
  meta?: Record<string, unknown>;
  /** Optional link back to a campaign / segment / agent that requested it. */
  attachedTo?: {
    kind: 'campaign' | 'agent' | 'manual';
    refId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const GeneratedAssetSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    type: { type: String, enum: ['image', 'video', 'audio'], required: true },
    provider: { type: String, required: true, index: true },
    modelName: { type: String },
    prompt: { type: String, required: true },
    negativePrompt: { type: String },
    size: { type: String },
    url: { type: String },
    inlineBase64: { type: String },
    status: {
      type: String,
      enum: ['pending', 'ready', 'failed'],
      default: 'pending',
      index: true,
    },
    errorMessage: { type: String },
    costUsd: { type: Number },
    meta: { type: Schema.Types.Mixed },
    attachedTo: {
      kind: { type: String, enum: ['campaign', 'agent', 'manual'] },
      refId: { type: String },
    },
  } as any,
  { timestamps: true },
);

GeneratedAssetSchema.index({ tenantId: 1, createdAt: -1 });

export default mongoose.model(
  'GeneratedAsset',
  GeneratedAssetSchema as any,
) as unknown as mongoose.Model<IGeneratedAsset>;
