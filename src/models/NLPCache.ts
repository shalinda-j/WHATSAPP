import mongoose, { Schema, Document, Model } from 'mongoose';

export interface INLPCache extends Document {
  intentName: string;
  userUtterances: string[];
  aiResponse: string;
  createdAt: Date;
  updatedAt: Date;
}

const NLPCacheSchema = new Schema<INLPCache>(
  {
    intentName: { type: String, required: true, unique: true },
    userUtterances: [{ type: String, required: true }],
    aiResponse: { type: String, required: true },
  },
  { timestamps: true },
);

// Handle hot-reloading by checking if model already exists
const NLPCache: Model<INLPCache> =
  (mongoose.models.NLPCache as Model<INLPCache>) ||
  mongoose.model<INLPCache>('NLPCache', NLPCacheSchema);

export default NLPCache;
