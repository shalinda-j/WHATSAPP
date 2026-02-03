import mongoose, { Schema, Document } from 'mongoose';

export interface IDataset extends Document {
  name: string;
  content: string;
  scope: string; // Now a free-text field for any company/region name
  category?: 'company' | 'faq' | 'promotion' | 'other';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DatasetSchema = new Schema(
  {
    name: { type: String, required: true },
    content: { type: String, required: true },
    scope: {
      type: String,
      default: 'ALL', // Default to ALL if not specified
    },
    category: {
      type: String,
      enum: ['company', 'faq', 'promotion', 'other'],
      default: 'company',
    },
    isActive: { type: Boolean, default: true },
  } as any,
  {
    timestamps: true,
  },
);

export default mongoose.model(
  'Dataset',
  DatasetSchema as any,
) as unknown as mongoose.Model<IDataset>;
