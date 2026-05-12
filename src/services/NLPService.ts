// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - node-nlp lacks TypeScript definitions
import { NlpManager } from 'node-nlp';
import NLPCache from '../models/NLPCache';
import crypto from 'crypto';

class NLPService {
  private manager: any;
  private isTrained = false;
  private isTraining = false;
  private needsRetraining = false;
  private initialized = false;

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

      // Add all cached utterances and answers
      let utteranceCount = 0;
      for (const cache of caches) {
        for (const utterance of cache.userUtterances) {
          this.manager.addDocument('en', utterance, cache.intentName);
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

      // If confidence is high enough (e.g., above 0.8), we trust the NLP layer
      // Note: node-nlp sets score=1 and intent='None' when no match found below threshold
      if (
        result.intent &&
        result.intent !== 'None' &&
        result.score > 0.8 &&
        result.answer
      ) {
        console.log(
          `🧠 [NLP CACHE HIT] Confidence: ${result.score.toFixed(2)}, Intent: ${
            result.intent
          }`,
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
      // Normalize inputs to avoid duplicates with slight variations
      const normalizedMessage = userMessage.trim().toLowerCase();
      const normalizedResponse = aiResponse.trim();

      // Create a unique hash for the AI response to group similar responses to the same intent
      const responseHash = crypto
        .createHash('md5')
        .update(normalizedResponse)
        .digest('hex');
      const intentName = `learned_intent_${responseHash.substring(0, 10)}`;

      // Check if this AI Response already exists as an intent
      let cache = await NLPCache.findOne({ intentName });

      if (cache) {
        // Check if this exact utterance already exists (case-insensitive check)
        const utteranceExists = cache.userUtterances.some(
          (u: string) => u.toLowerCase() === normalizedMessage,
        );

        if (!utteranceExists) {
          // Add new utterance to existing intent
          cache.userUtterances.push(userMessage.trim());
          await cache.save();

          // Add to NLP manager and retrain
          this.manager.addDocument('en', userMessage.trim(), intentName);
          console.log(
            `📝 [NLP LEARN] Added new utterance to existing intent: ${intentName}`,
          );

          await this._trainModel();
          return true;
        } else {
          // Utterance already exists, no need to retrain
          console.log(
            `📝 [NLP LEARN] Utterance already exists in intent: ${intentName}`,
          );
          return false;
        }
      } else {
        // Create new intent
        cache = new NLPCache({
          intentName,
          userUtterances: [userMessage.trim()],
          aiResponse: normalizedResponse,
        });
        await cache.save();

        // Add to NLP manager
        this.manager.addDocument('en', userMessage.trim(), intentName);
        this.manager.addAnswer('en', intentName, normalizedResponse);
        console.log(`✨ [NLP LEARN] Created new intent: ${intentName}`);

        await this._trainModel();
        return true;
      }
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
      this.isTrained = true;
      this.needsRetraining = false;
      console.log('🧹 [NLP] All cached data cleared.');
    } catch (error) {
      console.error('❌ Error clearing NLP cache:', error);
    }
  }

  /**
   * Get statistics about the NLP cache
   */
  async getStats(): Promise<{ intentCount: number; totalUtterances: number }> {
    try {
      const caches = await NLPCache.find();
      const totalUtterances = caches.reduce(
        (sum: number, c: any) => sum + c.userUtterances.length,
        0,
      );
      return {
        intentCount: caches.length,
        totalUtterances,
      };
    } catch (error) {
      console.error('❌ Error getting NLP stats:', error);
      return { intentCount: 0, totalUtterances: 0 };
    }
  }
}

export const nlpService = new NLPService();
