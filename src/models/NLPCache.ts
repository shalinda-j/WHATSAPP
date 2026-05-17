import mongoose, { Schema, Document } from 'mongoose';

export interface INLPCache extends Document {
  intentName: string;
  userUtterances: string[];
  /**
   * Canonical (normalised) form of every utterance — lowercased, punctuation
   * stripped, whitespace collapsed, Sinhala/Tamil unicode left intact. The
   * NLP layer reads against this list so morphologically-similar Sinhala
   * questions ("මිල කීයද" vs "මිල කොච්චරද") all collapse to the same
   * intent without forcing identical surface text.
   */
  canonicalUtterances: string[];
  aiResponse: string;
  /** Languages detected across the utterances (en / si / ta). */
  languages: string[];
  /** Number of times this cached answer has been served. */
  hits: number;
  /** Last time the cache served this entry — used for staleness / decay. */
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NLPCacheSchema = new Schema(
  {
    intentName: { type: String, required: true, unique: true },
    userUtterances: [{ type: String, required: true }],
    canonicalUtterances: { type: [String], default: [] },
    aiResponse: { type: String, required: true },
    languages: { type: [String], default: [] },
    hits: { type: Number, default: 0, index: true },
    lastUsedAt: { type: Date },
  } as any,
  { timestamps: true },
);

// Index for faster lookups
NLPCacheSchema.index({ intentName: 1 });
NLPCacheSchema.index({ canonicalUtterances: 1 });

export default mongoose.model(
  'NLPCache',
  NLPCacheSchema as any,
) as unknown as mongoose.Model<INLPCache>;
