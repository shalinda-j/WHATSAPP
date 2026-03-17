import mongoose, { Schema, Document } from 'mongoose';

export interface INLPCache extends Document {
  intentName: string;
  userUtterances: string[];
  aiResponse: string;
}

const NLPCacheSchema = new Schema(
  {
    intentName: { type: String, required: true, unique: true },
    userUtterances: [{ type: String, required: true }],
    aiResponse: { type: String, required: true },
  } as any,
  { timestamps: true },
);

// Index for faster lookups
NLPCacheSchema.index({ intentName: 1 });

export default mongoose.model(
  'NLPCache',
  NLPCacheSchema as any,
) as unknown as mongoose.Model<INLPCache>;
