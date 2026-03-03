import { NlpManager } from 'node-nlp';
import NLPCache from '../models/NLPCache';
import crypto from 'crypto';

class NLPService {
    private manager: any;
    private isTrained: boolean = false;
    private isTraining: boolean = false;

    constructor() {
        // Initialize standard NlpManager using default settings. 
        // We use generic tokenization since Sinhala isn't natively supported, space separation works out of the box.
        this.manager = new (NlpManager as any)({ languages: ['en'], forceNER: true, nlu: { log: false } });
    }

    /**
     * Loads all learned intents from the Database and trains the Model in memory.
     */
    async initializeNLP() {
        try {
            console.log('🔄 Loading Local NLP Model from Database...');
            const caches = await NLPCache.find();

            if (caches.length === 0) {
                console.log('ℹ️ Local NLP Model is empty. Waiting for AI interactions to learn from.');
                this.isTrained = true;
                return;
            }

            // Add all cached utterances and answers
            for (const cache of caches) {
                for (const utterance of cache.userUtterances) {
                    this.manager.addDocument('en', utterance, cache.intentName);
                }
                this.manager.addAnswer('en', cache.intentName, cache.aiResponse);
            }

            await this._trainModel();
        } catch (error) {
            console.error('❌ Failed to initialize Local NLP:', error);
        }
    }

    /**
     * Internal method to train the model.
     */
    private async _trainModel() {
        if (this.isTraining) return;
        this.isTraining = true;
        try {
            console.log('⏳ Training Local NLP Model...');
            await this.manager.train();
            this.isTrained = true;
            console.log('✅ Local NLP Model Trained Successfully.');
        } catch (error) {
            console.error('❌ Error training Local NLP Model:', error);
        } finally {
            this.isTraining = false;
        }
    }

    /**
     * Processes an incoming message through the Local NLP Model.
     * If a match with high confidence is found, it returns the stored AI Response.
     * Otherwise, it returns null.
     */
    async processMessage(userMessage: string): Promise<string | null> {
        if (!this.isTrained) return null;

        try {
            const result = await this.manager.process('en', userMessage);

            // If confidence is high enough (e.g., above 0.8), we trust the NLP layer
            if (result.intent && result.intent !== 'None' && result.score > 0.8 && result.answer) {
                console.log(`🧠 [NLP CACHE HIT] Confidence: ${result.score.toFixed(2)}, Intent: ${result.intent}`);
                return result.answer;
            }

            // No match or low confidence
            return null;
        } catch (error) {
            console.error('❌ Error processing message in Local NLP:', error);
            return null;
        }
    }

    /**
     * Learns from a new interaction and updates the model dynamically.
     */
    async learnFromAI(userMessage: string, aiResponse: string) {
        try {
            // Create a unique hash for the Ai response to group similar responses to the same intent
            const responseHash = crypto.createHash('md5').update(aiResponse).digest('hex');
            const intentName = `learned_intent_${responseHash.substring(0, 10)}`;

            // Check if this Ai Response already exists as an intent
            let cache = await NLPCache.findOne({ intentName });

            if (cache) {
                // Only update if the utterance doesn't already exist
                if (!cache.userUtterances.includes(userMessage)) {
                    cache.userUtterances.push(userMessage);
                    await cache.save();

                    this.manager.addDocument('en', userMessage, intentName);
                    await this._trainModel();
                }
            } else {
                // Create new intent
                cache = new NLPCache({
                    intentName,
                    userUtterances: [userMessage],
                    aiResponse
                });
                await cache.save();

                this.manager.addDocument('en', userMessage, intentName);
                this.manager.addAnswer('en', intentName, aiResponse);
                await this._trainModel();
            }
        } catch (error) {
            console.error('❌ Error learning from AI in Local NLP:', error);
        }
    }
}

export const nlpService = new NLPService();
