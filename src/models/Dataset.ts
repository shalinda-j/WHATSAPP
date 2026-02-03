import mongoose, { Schema, Document } from 'mongoose';

export interface IDataset extends Document {
  name: string;
  content: any; // Changed from string to any (Mixed)
  scope: string;
  category: string;
  key?: string; // New field
  description?: string; // New field
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DatasetSchema = new Schema(
  {
    name: { type: String, required: true },
    // content can be string or JSON object
    content: { type: Schema.Types.Mixed, required: true },
    scope: { type: String, default: 'ALL' },
    category: {
      type: String,
      // Extensible categories
      default: 'company',
    },
    // Optional key for programmatic access (e.g., 'REGISTRATION_LINKS')
    key: { type: String, unique: true, sparse: true },
    isActive: { type: Boolean, default: true },
    description: { type: String },
  },
  {
    timestamps: true,
  },
);

// Prevent model overwrite error in dev mode
const Dataset =
  mongoose.models.Dataset || mongoose.model<IDataset>('Dataset', DatasetSchema);
export default Dataset;
