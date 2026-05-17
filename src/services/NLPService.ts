// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - node-nlp lacks TypeScript definitions
import { NlpManager } from 'node-nlp';
import NLPCache from '../models/NLPCache';
import crypto from 'crypto';
import { normaliseUtterance, detectLanguage } from './nlpNormalise';
import { agentRAGService } from './AgentRAGService';

/**
 * Cosine similarity over two equal-length vectors. Returns 0 when either
 * vector is empty/missing or when their magnitudes are zero (rather than
 * NaN, which would break the > threshold comparison downstream).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * If two AI responses have cosine similarity ≥ this threshold their embeddings
 * are close enough that we treat them as "the same answer worded differently"
 * and merge them under one intent rather than creating a fresh intent.
 * Tuned conservatively — at 0.9 only paraphrases of the same fact collapse;
 * unrelated answers comfortably score below 0.7.
 */
const SEMANTIC_MERGE_THRESHOLD = 0.9;

class NLPService {
  private manager: any;
  private isTrained = false;
  private isTraining = false;
  private needsRetraining = false;
  private initialized = false;
  /**
   * In-memory canonical-form → intentName map. Built at boot, kept in sync
   * by learnFromAI. Lets processMessage short-circuit a full node-nlp
   * classification when the user just repeated a previously-seen question
   * (the dominant cache-hit case). O(1) lookup vs O(intents) classifier.
   */
  private canonicalIndex: Map<string, string> = new Map();

  constructor() {
    // Initialize standard NlpManager using default settings.
    // We use generic tokenization since Sinhala isn't natively supported, space separation works out of the box.
    this.manager = new (NlpManager as any)({
      languages: ['en'],
      forceNER: true,
      nlu: { log: false },
    });
  }

  /**
   * Loads all learned intents from the Database and trains the Model in memory.
   */
  async initializeNLP(): Promise<boolean> {
    if (this.initialized) {
      console.log('ℹ️ NLP Service already initialized.');
      return true;
    }

    try {
      console.log('🔄 Loading Local NLP Model from Database...');
      const caches = await NLPCache.find().maxTimeMS(10000);

      if (caches.length === 0) {
        console.log(
          'ℹ️ Local NLP Model is empty. Waiting for AI interactions to learn from.',
        );
        this.isTrained = true;
        this.initialized = true;
        return true;
      }

      console.log(`📚 Found ${caches.length} cached intents. Loading...`);

      // Add all cached utterances and answers. We feed node-nlp the
      // canonical form (so Sinhala/Tamil suffix variants collapse) and
      // simultaneously build the in-memory canonicalIndex used for the
      // fast-path exact match in processMessage.
      let utteranceCount = 0;
      this.canonicalIndex.clear();
      for (const cache of caches) {
        const canonicals = (cache as { canonicalUtterances?: string[] })
          .canonicalUtterances?.length
          ? (cache as { canonicalUtterances: string[] }).canonicalUtterances
          : cache.userUtterances.map(normaliseUtterance);
        for (let i = 0; i < cache.userUtterances.length; i++) {
          const raw = cache.userUtterances[i];
          const canon = canonicals[i] ?? normaliseUtterance(raw);
          // Feed both the raw + canonical forms so node-nlp's classifier
          // sees the widest training surface for variants we miss in
          // the suffix list.
          this.manager.addDocument('en', raw, cache.intentName);
          if (canon && canon !== raw.toLowerCase()) {
            this.manager.addDocument('en', canon, cache.intentName);
          }
          if (canon) this.canonicalIndex.set(canon, cache.intentName);
          utteranceCount++;
        }
        this.manager.addAnswer('en', cache.intentName, cache.aiResponse);
      }

      console.log(
        `📝 Loaded ${utteranceCount} utterances across ${caches.length} intents.`,
      );

      await this._trainModel();
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Local NLP:', error);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Check if the service is ready to process messages
   */
  isReady(): boolean {
    return this.initialized && this.isTrained;
  }

  /**
   * Internal method to train the model.
   * Implements a queue mechanism to handle concurrent training requests.
   */
  private async _trainModel(): Promise<boolean> {
    if (this.isTraining) {
      // Mark that retraining is needed after current training completes
      this.needsRetraining = true;
      console.log('⏳ Training already in progress. Queuing retraining...');
      return false;
    }

    this.isTraining = true;
    let success = false;

    try {
      console.log('⏳ Training Local NLP Model...');
      await this.manager.train();
      this.isTrained = true;
      success = true;
      console.log('✅ Local NLP Model Trained Successfully.');
    } catch (error) {
      console.error('❌ Error training Local NLP Model:', error);
      this.isTrained = false;
    } finally {
      this.isTraining = false;

      // If retraining was requested during training, do it now
      if (this.needsRetraining) {
        this.needsRetraining = false;
        console.log('🔄 Running queued retraining...');
        await this._trainModel();
      }
    }

    return success;
  }

  /**
   * Processes an incoming message through the Local NLP Model.
   * If a match with high confidence is found, it returns the stored AI Response.
   * Otherwise, it returns null.
   *
   * @param userMessage - The user's message to process
   * @returns The cached AI response if found, null otherwise
   */
  async processMessage(userMessage: string): Promise<string | null> {
    // Guard: Service not ready
    if (!this.isReady()) {
      console.log('⚠️ NLP Service not ready. Skipping cache lookup.');
      return null;
    }

    // Guard: Empty message
    if (!userMessage || userMessage.trim().length === 0) {
      return null;
    }

    try {
      // ── Fast path: exact canonical match ─────────────────────────────
      // The dominant cache-hit pattern is the same question repeated with
      // trivial surface differences (extra '?', different casing, a stray
      // suffix). We canonicalise the inbound text and look it up directly
      // in the in-memory index — skips a full classification when it
      // would have returned a near-1.0 score anyway.
      const canon = normaliseUtterance(userMessage);
      if (canon && this.canonicalIndex.has(canon)) {
        const intentName = this.canonicalIndex.get(canon)!;
        // Pull the persisted answer + increment hit count atomically.
        const row = await NLPCache.findOneAndUpdate(
          { intentName },
          { $inc: { hits: 1 }, $set: { lastUsedAt: new Date() } },
          { new: true },
        );
        if (row?.aiResponse) {
          console.log(
            `🧠 [NLP CACHE HIT — canonical] intent=${intentName}, hits=${row.hits}`,
          );
          return row.aiResponse;
        }
      }

      // ── Slow path: node-nlp classifier ───────────────────────────────
      const result = await this.manager.process('en', userMessage);

      // Debug logging for development
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `🔍 NLP Debug: Intent="${
            result.intent
          }", Score=${result.score?.toFixed(3)}, Answer=${
            result.answer ? 'Yes' : 'No'
          }`,
        );
      }

      // If confidence is high enough (e.g., above 0.8), we trust the NLP layer.
      // node-nlp sets score=1 and intent='None' when no match found below
      // its internal threshold — we additionally require score>0.8 to keep
      // false-positives from the LLM-quality bar low.
      if (
        result.intent &&
        result.intent !== 'None' &&
        result.score > 0.8 &&
        result.answer
      ) {
        // Track the hit on the persisted row + update lastUsedAt so the
        // analytics endpoints can rank intents by usage.
        await NLPCache.updateOne(
          { intentName: result.intent },
          { $inc: { hits: 1 }, $set: { lastUsedAt: new Date() } },
        ).catch((err: unknown) => {
          // Hit-counter update failure is non-fatal — the cached answer
          // still goes back to the user.
          console.error('Failed to increment NLP hit count:', err);
        });
        console.log(
          `🧠 [NLP CACHE HIT — classifier] confidence=${result.score.toFixed(
            2,
          )}, intent=${result.intent}`,
        );
        return result.answer;
      }

      // No match or low confidence - fall through to AI
      return null;
    } catch (error) {
      console.error('❌ Error processing message in Local NLP:', error);
      return null;
    }
  }

  /**
   * Learns from a new interaction and updates the model dynamically.
   * Uses MD5 hash of the AI response to group similar questions under the same intent.
   *
   * @param userMessage - The user's question/utterance
   * @param aiResponse - The AI's response to learn
   */
  async learnFromAI(userMessage: string, aiResponse: string): Promise<boolean> {
    // Guard: Service not ready
    if (!this.isReady()) {
      console.log('⚠️ NLP Service not ready. Skipping learning.');
      return false;
    }

    // Guard: Invalid inputs
    if (!userMessage?.trim() || !aiResponse?.trim()) {
      console.log('⚠️ Empty message or response. Skipping learning.');
      return false;
    }

    try {
      const rawMessage = userMessage.trim();
      const normalizedResponse = aiResponse.trim();
      // Canonical form is the key both for de-duping utterances and for
      // the fast-path index. Detect the language for analytics.
      const canonical = normaliseUtterance(rawMessage);
      const lang = detectLanguage(rawMessage);

      // ── Semantic grouping ──────────────────────────────────────────────
      // Before falling back to the exact MD5(response) bucket, embed the
      // response and check whether any existing intent's cached response
      // is semantically the same (cosine ≥ SEMANTIC_MERGE_THRESHOLD).
      // This collapses "Our hours are 9 to 5" and "We're open from 9 AM
      // to 5 PM" into one intent instead of two — a major cache-hit-rate
      // win because the next user phrasing only needs to match one of the
      // collapsed intents.
      //
      // The embedding step degrades gracefully:
      //  - No OPENAI_API_KEY → embedText returns null → we skip semantic
      //    grouping and fall through to MD5 grouping (the old behaviour).
      //  - Mongo down → catch silences and falls through.
      let intentName: string | null = null;
      let responseEmbedding: number[] | null = null;
      if (agentRAGService.isEmbeddingReady()) {
        responseEmbedding = await agentRAGService.embedText(normalizedResponse);
        if (responseEmbedding) {
          try {
            // Pull every intent that *has* an embedding. Bounded by the
            // cache size which is operator-controlled.
            const candidates = await NLPCache.find({
              responseEmbedding: { $exists: true, $not: { $size: 0 } },
            })
              .select('intentName responseEmbedding')
              .lean();
            let best: { intentName: string; score: number } | null = null;
            for (const c of candidates as Array<{
              intentName: string;
              responseEmbedding?: number[];
            }>) {
              if (!c.responseEmbedding) continue;
              const score = cosineSimilarity(
                responseEmbedding,
                c.responseEmbedding,
              );
              if (!best || score > best.score) {
                best = { intentName: c.intentName, score };
              }
            }
            if (best && best.score >= SEMANTIC_MERGE_THRESHOLD) {
              intentName = best.intentName;
              console.log(
                `🧬 [NLP LEARN] Semantic merge into ${best.intentName} (cos=${best.score.toFixed(3)})`,
              );
            }
          } catch (err) {
            console.error('Semantic grouping lookup failed:', err);
          }
        }
      }

      // Fall back to MD5(response) bucket when semantic grouping didn't
      // find a sibling intent (or the embedding step was skipped).
      if (!intentName) {
        const responseHash = crypto
          .createHash('md5')
          .update(normalizedResponse)
          .digest('hex');
        intentName = `learned_intent_${responseHash.substring(0, 10)}`;
      }

      // ── Cross-intent canonical guard ───────────────────────────────────
      // If we've already learned this exact canonical question under a
      // *different* intent (different LLM response), don't shadow that
      // intent — skip the learn step rather than poisoning the cache with
      // conflicting answers for the same question.
      const indexedIntent = this.canonicalIndex.get(canonical);
      if (indexedIntent && indexedIntent !== intentName) {
        console.log(
          `⚠️ [NLP LEARN] Canonical "${canonical.slice(0, 50)}" already maps to ${indexedIntent}; skipping conflicting learn.`,
        );
        return false;
      }

      // Check if this AI Response already exists as an intent
      let cache = await NLPCache.findOne({ intentName });

      if (cache) {
        // Dedupe on the canonical form, not the raw text — that's what
        // makes the cache learn variants instead of accumulating duplicates.
        const cacheCanonicals = (cache as { canonicalUtterances?: string[] })
          .canonicalUtterances ?? [];
        const utteranceExists =
          cacheCanonicals.includes(canonical) ||
          cache.userUtterances.some(
            (u: string) => normaliseUtterance(u) === canonical,
          );

        if (!utteranceExists) {
          cache.userUtterances.push(rawMessage);
          cacheCanonicals.push(canonical);
          (cache as { canonicalUtterances: string[] }).canonicalUtterances =
            cacheCanonicals;
          const langs = new Set([
            ...((cache as { languages?: string[] }).languages ?? []),
            lang,
          ]);
          (cache as { languages: string[] }).languages = Array.from(langs);
          // Backfill the embedding when we have one and the existing row
          // doesn't — lets a row created pre-embedding participate in
          // future semantic-merge lookups.
          const existingEmbedding = (
            cache as { responseEmbedding?: number[] }
          ).responseEmbedding;
          if (
            responseEmbedding &&
            (!existingEmbedding || existingEmbedding.length === 0)
          ) {
            (cache as { responseEmbedding?: number[] }).responseEmbedding =
              responseEmbedding;
          }
          await cache.save();

          // Feed both raw and canonical to the classifier so suffix
          // variants and partial-match phrasings both classify.
          this.manager.addDocument('en', rawMessage, intentName);
          if (canonical && canonical !== rawMessage.toLowerCase()) {
            this.manager.addDocument('en', canonical, intentName);
          }
          this.canonicalIndex.set(canonical, intentName);
          console.log(
            `📝 [NLP LEARN] Added new utterance to existing intent: ${intentName} (lang=${lang})`,
          );

          await this._trainModel();
          return true;
        }
        console.log(
          `📝 [NLP LEARN] Utterance already exists in intent: ${intentName}`,
        );
        return false;
      }

      cache = new NLPCache({
        intentName,
        userUtterances: [rawMessage],
        canonicalUtterances: [canonical],
        languages: [lang],
        aiResponse: normalizedResponse,
        // Persist the embedding so future learn calls can semantic-merge
        // against this intent. May be undefined when no embedding provider
        // is configured — that's fine, the field is optional.
        responseEmbedding: responseEmbedding ?? undefined,
        hits: 0,
      });
      await cache.save();

      this.manager.addDocument('en', rawMessage, intentName);
      if (canonical && canonical !== rawMessage.toLowerCase()) {
        this.manager.addDocument('en', canonical, intentName);
      }
      this.manager.addAnswer('en', intentName, normalizedResponse);
      this.canonicalIndex.set(canonical, intentName);
      console.log(
        `✨ [NLP LEARN] Created new intent: ${intentName} (lang=${lang})`,
      );

      await this._trainModel();
      return true;
    } catch (error) {
      console.error('❌ Error learning from AI in Local NLP:', error);
      return false;
    }
  }

  /**
   * Clears all learned data and reinitializes the model.
   * Useful for testing or resetting the cache.
   */
  async clearAll(): Promise<void> {
    try {
      await NLPCache.deleteMany({});
      this.manager = new (NlpManager as any)({
        languages: ['en'],
        forceNER: true,
        nlu: { log: false },
      });
      this.canonicalIndex.clear();
      this.isTrained = true;
      this.needsRetraining = false;
      console.log('🧹 [NLP] All cached data cleared.');
    } catch (error) {
      console.error('❌ Error clearing NLP cache:', error);
    }
  }

  /**
   * Aggregate statistics about the NLP cache — includes hit-driven metrics
   * so an operator can see exactly which cached intents are paying for
   * themselves (vs. being indexed but never matched).
   */
  async getStats(): Promise<{
    intentCount: number;
    totalUtterances: number;
    totalHits: number;
    languageBreakdown: Record<string, number>;
    topIntents: Array<{
      intentName: string;
      hits: number;
      lastUsedAt: Date | null;
      sampleUtterance: string;
      response: string;
    }>;
  }> {
    try {
      const caches = await NLPCache.find().lean();
      const totalUtterances = caches.reduce(
        (sum: number, c: any) => sum + (c.userUtterances?.length ?? 0),
        0,
      );
      const totalHits = caches.reduce(
        (sum: number, c: any) => sum + (c.hits ?? 0),
        0,
      );

      const languageBreakdown: Record<string, number> = {};
      for (const c of caches as Array<{ languages?: string[] }>) {
        for (const lang of c.languages ?? []) {
          languageBreakdown[lang] = (languageBreakdown[lang] ?? 0) + 1;
        }
      }

      const topIntents = [...caches]
        .sort(
          (a: { hits?: number }, b: { hits?: number }) =>
            (b.hits ?? 0) - (a.hits ?? 0),
        )
        .slice(0, 20)
        .map(
          (c: {
            intentName: string;
            hits?: number;
            lastUsedAt?: Date;
            userUtterances: string[];
            aiResponse: string;
          }) => ({
            intentName: c.intentName,
            hits: c.hits ?? 0,
            lastUsedAt: c.lastUsedAt ?? null,
            sampleUtterance: c.userUtterances[0] ?? '',
            response: c.aiResponse.slice(0, 200),
          }),
        );

      return {
        intentCount: caches.length,
        totalUtterances,
        totalHits,
        languageBreakdown,
        topIntents,
      };
    } catch (error) {
      console.error('❌ Error getting NLP stats:', error);
      return {
        intentCount: 0,
        totalUtterances: 0,
        totalHits: 0,
        languageBreakdown: {},
        topIntents: [],
      };
    }
  }
}

export const nlpService = new NLPService();
