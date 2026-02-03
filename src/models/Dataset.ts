import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IDataset {
  name: string;
  content: any; // Mixed
  scope: string;
  category: string;
  key?: string;
  description?: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IDatasetDocument extends IDataset, Document { }

const DatasetSchema = new Schema(
  {
    name: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    scope: { type: String, default: 'ALL' },
    category: {
      type: String,
      default: 'company',
    },
    key: { type: String, unique: true, sparse: true },
    isActive: { type: Boolean, default: true },
    description: { type: String },
  },
  {
    timestamps: true,
  },
);

let Dataset: Model<any>;
if (mongoose.models.Dataset) {
  Dataset = mongoose.models.Dataset;
} else {
  Dataset = (mongoose.model as any)('Dataset', DatasetSchema as any);
}

export default Dataset;
