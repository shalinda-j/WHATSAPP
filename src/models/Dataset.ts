import mongoose, { Schema, Model } from 'mongoose';

// Dataset types for different sections
export type DatasetType = 'knowledge' | 'command' | 'link' | 'marketing' | 'megatext' | 'personality' | 'config';

// Supported languages
export type Language = 'en' | 'si' | 'ta';

// Multi-language content structure
export interface MultiLanguageContent {
  en?: string | Record<string, unknown>;
  si?: string | Record<string, unknown>;
  ta?: string | Record<string, unknown>;
}

// Metadata for different dataset types
export interface DatasetMetadata {
  // For commands
  triggerKeywords?: string[];
  aliases?: string[];
  // For marketing
  schedule?: Date;
  targetAudience?: string[];
  // For links
  url?: string;
  formId?: string;
  // For megatext
  documentType?: 'knowledge' | 'template';
}

// Main Dataset interface
export interface IDataset {
  _id: string;
  name: string;
  description?: string;
  type: DatasetType;
  content: MultiLanguageContent;
  scope: string;
  category: string;
  key: string;
  isActive: boolean;
  metadata?: DatasetMetadata;
  createdAt: Date;
  updatedAt: Date;
}

const DatasetSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    type: {
      type: String,
      enum: ['knowledge', 'command', 'link', 'marketing', 'megatext', 'personality', 'config'],
      default: 'knowledge',
      index: true,
    },
    content: {
      en: { type: Schema.Types.Mixed },
      si: { type: Schema.Types.Mixed },
      ta: { type: Schema.Types.Mixed },
    },
    scope: { type: String, default: 'ALL' },
    category: {
      type: String,
      default: 'general',
    },
    key: { type: String, unique: true, sparse: true },
    isActive: { type: Boolean, default: true },
    metadata: {
      triggerKeywords: [{ type: String }],
      aliases: [{ type: String }],
      schedule: { type: Date },
      targetAudience: [{ type: String }],
      url: { type: String },
      formId: { type: String },
      documentType: { type: String, enum: ['knowledge', 'template'] },
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient querying
DatasetSchema.index({ type: 1, isActive: 1 });
DatasetSchema.index({ key: 1 });

let Dataset: Model<any>;
if (mongoose.models.Dataset) {
  Dataset = mongoose.models.Dataset;
} else {
  Dataset = (mongoose.model as any)('Dataset', DatasetSchema as any);
}

export default Dataset;
