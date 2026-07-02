import mongoose, { Schema, Model } from 'mongoose';

// Dataset types for different sections
export type DatasetType =
  | 'knowledge'
  | 'command'
  | 'link'
  | 'marketing'
  | 'megatext'
  | 'personality'
  | 'config';

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
    // Multi-tenancy: which tenant owns this dataset row. Optional so
    // legacy rows (and the auto-seeded config placeholders) remain
    // visible via the route-level $or filter.
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String },
    type: {
      type: String,
      enum: [
        'knowledge',
        'command',
        'link',
        'marketing',
        'megatext',
        'personality',
        'config',
      ],
      default: 'knowledge',
      index: true,
    },
    // Stored as a Mixed value. The multi-language convention is a
    // { en, si, ta } map (each language a string or object), but some config
    // datasets (HUMANIZER_CONFIG, BOOKING_CONFIG, COMPANY_INFO) store a FLAT
    // object directly. Declaring only en/si/ta subpaths made Mongoose's strict
    // mode silently strip every key of those flat objects on save (content
    // persisted as {} — the operator's settings vanished). Mixed accepts both
    // shapes; readers in ConfigService already handle string / {en} / flat.
    content: { type: Schema.Types.Mixed },
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

// Indexes for efficient querying.
// NOTE: `key` is already indexed by its path-level `unique: true, sparse: true`
// above. Re-declaring DatasetSchema.index({ key: 1 }) here created a SECOND,
// conflicting index spec on the same field (plain vs unique+sparse), which
// MongoDB rejects with IndexOptionsConflict when indexes are (re)built.
DatasetSchema.index({ type: 1, isActive: 1 });

let Dataset: Model<any>;
if (mongoose.models.Dataset) {
  Dataset = mongoose.models.Dataset;
} else {
  Dataset = (mongoose.model as any)('Dataset', DatasetSchema as any);
}

export default Dataset;
