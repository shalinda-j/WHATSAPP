import mongoose, { Schema, Model } from 'mongoose';

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
