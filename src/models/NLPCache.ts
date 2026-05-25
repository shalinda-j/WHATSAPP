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
  /**
   * OpenAI text-embedding-3-small vector of `aiResponse` (1536 dims).
   * Used to merge semantically-similar AI responses into one intent even
   * when the surface text differs — e.g. "Our hours are 9 to 5" and
   * "We're open from 9 AM to 5 PM" should collapse instead of producing
   * two separate intent rows. Null when no embedding provider is set.
   */
  responseEmbedding?: number[];
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
    // `sparse: true` makes the unique index skip docs where `intentName`
    // is null/missing. Without sparse, two legacy rows that wrote
    // intentName='' (the same trap that bit Dataset.key) would collide
    // on the unique index even though the field is technically `required`.
    // Belt-and-braces: required guards new writes, sparse protects the
    // unique index from older data shapes.
    intentName: { type: String, required: true, unique: true, sparse: true },
    userUtterances: [{ type: String, required: true }],
    canonicalUtterances: { type: [String], default: [] },
    aiResponse: { type: String, required: true },
    responseEmbedding: { type: [Number] },
    languages: { type: [String], default: [] },
    hits: { type: Number, default: 0, index: true },
    lastUsedAt: { type: Date },
  } as any,
  { timestamps: true },
);

// Index for faster lookups
NLPCacheSchema.index({ intentName: 1 });
NLPCacheSchema.index({ canonicalUtterances: 1 });

const __NLPCacheModel =
  mongoose.models.NLPCache || mongoose.model('NLPCache', NLPCacheSchema as any);
export default __NLPCacheModel as unknown as mongoose.Model<INLPCache>;
