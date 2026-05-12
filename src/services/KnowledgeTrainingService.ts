import KnowledgeEntry, { IKnowledgeEntry } from '../models/KnowledgeEntry';
import Dataset from '../models/Dataset';
import { configurationManager } from './ConfigurationManagerService';
import { aiLoadBalancer } from './AILoadBalancer';

/**
 * KnowledgeTrainingService
 * Manages real-time AI training with knowledge base
 * Supports:
 * - Auto-learning from successful conversations
 * - Manual knowledge entry
 * - Import from documents
 * - Real-time knowledge sync
 */

// Minimum confidence threshold for auto-learning
const AUTO_LEARN_CONFIDENCE_THRESHOLD = 0.8;
const MIN_MESSAGE_LENGTH = 10;
const MAX_AUTO_LEARN_PER_DAY = 100;

export class KnowledgeTrainingService {
  private static instance: KnowledgeTrainingService;
  private knowledgeCache: Map<string, IKnowledgeEntry[]> = new Map();
  private lastCacheRefresh = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes
  private autoLearnCount = 0;
  private lastAutoLearnReset: number = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): KnowledgeTrainingService {
    if (!KnowledgeTrainingService.instance) {
      KnowledgeTrainingService.instance = new KnowledgeTrainingService();
    }
    return KnowledgeTrainingService.instance;
  }

  /**
   * Get knowledge base as formatted text for AI context
   */
  async getKnowledgeBaseForAI(category?: string): Promise<string> {
    try {
      await this.refreshCacheIfNeeded();

      let entries = await KnowledgeEntry.find({ isActive: true })
        .sort({ usageCount: -1, confidence: -1 })
        .limit(100);

      if (category) {
        entries = entries.filter((e) => e.category === category);
      }

      if (entries.length === 0) {
        // Fallback to dataset knowledge base
        const datasetKB = await configurationManager.getAIKnowledgeBase();
        return datasetKB;
      }

      // Format as Q&A pairs for AI
      const formattedKB = entries
        .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
        .join('\n\n');

      return `# Knowledge Base (${entries.length} entries)\n\n${formattedKB}`;
    } catch (error) {
      console.error('[KnowledgeTraining] Error getting knowledge base:', error);
      return await configurationManager.getAIKnowledgeBase();
    }
  }

  /**
   * Search for relevant knowledge entries
   */
  async searchKnowledge(query: string, limit = 5): Promise<IKnowledgeEntry[]> {
    try {
      // Use text search if available
      const results = await KnowledgeEntry.find(
        { isActive: true },
        { score: { $meta: 'textScore' } },
      )
        .find({ $text: { $search: query } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit);

      // Update usage count
      if (results.length > 0) {
        await KnowledgeEntry.updateMany(
          { _id: { $in: results.map((r) => r._id) } },
          { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
        );
      }

      return results;
    } catch (error) {
      // Fallback to regex search if text index not available
      console.log('[KnowledgeTraining] Using fallback regex search');
      const regexResults = await KnowledgeEntry.find({
        isActive: true,
        $or: [
          { question: { $regex: query, $options: 'i' } },
          { tags: { $in: [new RegExp(query, 'i')] } },
        ],
      }).limit(limit);

      return regexResults;
    }
  }

  /**
   * Add knowledge entry manually
   */
  async addKnowledge(
    question: string,
    answer: string,
    category = 'general',
    tags: string[] = [],
    language: 'en' | 'si' | 'ta' | 'hi' | 'all' = 'all',
  ): Promise<IKnowledgeEntry> {
    const entry = await KnowledgeEntry.create({
      question,
      answer,
      category,
      tags,
      source: 'manual',
      confidence: 1.0,
      usageCount: 0,
      isActive: true,
      language,
    });

    console.log(
      `[KnowledgeTraining] Added knowledge: "${question.substring(0, 50)}..."`,
    );

    // Invalidate cache
    this.invalidateCache();

    return entry;
  }

  /**
   * Auto-learn from conversation (called when AI gives a good response)
   */
  async learnFromConversation(
    userMessage: string,
    aiResponse: string,
    confidence = 1.0,
  ): Promise<boolean> {
    try {
      // Reset daily counter
      if (Date.now() - this.lastAutoLearnReset > 24 * 60 * 60 * 1000) {
        this.autoLearnCount = 0;
        this.lastAutoLearnReset = Date.now();
      }

      // Check daily limit
      if (this.autoLearnCount >= MAX_AUTO_LEARN_PER_DAY) {
        return false;
      }

      // Validate input
      if (
        userMessage.length < MIN_MESSAGE_LENGTH ||
        aiResponse.length < MIN_MESSAGE_LENGTH
      ) {
        return false;
      }

      // Check if similar question already exists
      const existing = await KnowledgeEntry.findOne({
        question: {
          $regex: new RegExp(`^${userMessage.substring(0, 50)}`, 'i'),
        },
      });

      if (existing) {
        // Update existing entry confidence
        existing.confidence = Math.min(1.0, existing.confidence + 0.1);
        existing.usageCount += 1;
        await existing.save();
        return true;
      }

      // Detect language
      const language = this.detectLanguage(userMessage);

      // Create new knowledge entry
      await KnowledgeEntry.create({
        question: userMessage,
        answer: aiResponse,
        category: 'learned',
        tags: this.extractTags(userMessage),
        source: 'conversation',
        confidence: Math.min(confidence, AUTO_LEARN_CONFIDENCE_THRESHOLD),
        usageCount: 1,
        isActive: true,
        language,
      });

      this.autoLearnCount++;
      console.log(
        `[KnowledgeTraining] Auto-learned: "${userMessage.substring(
          0,
          30,
        )}..." (${this.autoLearnCount}/${MAX_AUTO_LEARN_PER_DAY} today)`,
      );

      return true;
    } catch (error) {
      console.error('[KnowledgeTraining] Error auto-learning:', error);
      return false;
    }
  }

  /**
   * Import knowledge from dataset
   */
  async importFromDataset(datasetKey: string): Promise<number> {
    try {
      const dataset = await Dataset.findOne({ key: datasetKey });
      if (!dataset || !dataset.content) {
        return 0;
      }

      let importCount = 0;
      const content = dataset.content;

      // Handle different content formats
      if (Array.isArray(content)) {
        // Array of Q&A objects
        for (const item of content) {
          if (item.question && item.answer) {
            await this.addKnowledge(
              item.question,
              item.answer,
              item.category || datasetKey.toLowerCase(),
              item.tags || [],
            );
            importCount++;
          }
        }
      } else if (typeof content === 'string') {
        // Parse as text (Q: ... A: ... format)
        const pairs = this.parseQAText(content);
        for (const pair of pairs) {
          await this.addKnowledge(
            pair.question,
            pair.answer,
            datasetKey.toLowerCase(),
          );
          importCount++;
        }
      }

      console.log(
        `[KnowledgeTraining] Imported ${importCount} entries from dataset: ${datasetKey}`,
      );
      return importCount;
    } catch (error) {
      console.error('[KnowledgeTraining] Error importing from dataset:', error);
      return 0;
    }
  }

  /**
   * Sync knowledge base with AI load balancer
   */
  async syncWithAI(): Promise<void> {
    try {
      const knowledgeBase = await this.getKnowledgeBaseForAI();
      const personality = await configurationManager.getAIPersonality();

      // Update the AI_PERSONALITY dataset with new knowledge
      await Dataset.findOneAndUpdate(
        { key: 'AI_PERSONALITY' },
        { content: `${personality}\n\n${knowledgeBase}` },
        { upsert: true },
      );

      // Clear configuration cache so AI picks up new knowledge
      configurationManager.clearCache();

      console.log('[KnowledgeTraining] Synced knowledge base with AI');
    } catch (error) {
      console.error('[KnowledgeTraining] Error syncing with AI:', error);
    }
  }

  /**
   * Get training statistics
   */
  async getStats(): Promise<{
    totalEntries: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    avgConfidence: number;
    avgUsage: number;
    recentlyAdded: number;
  }> {
    try {
      const totalEntries = await KnowledgeEntry.countDocuments({
        isActive: true,
      });

      const byCategory = await KnowledgeEntry.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]);

      const bySource = await KnowledgeEntry.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]);

      const stats = await KnowledgeEntry.aggregate([
        { $match: { isActive: true } },
        {
          $group: {
            _id: null,
            avgConfidence: { $avg: '$confidence' },
            avgUsage: { $avg: '$usageCount' },
          },
        },
      ]);

      const recentlyAdded = await KnowledgeEntry.countDocuments({
        isActive: true,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      return {
        totalEntries,
        byCategory: byCategory.reduce(
          (acc: Record<string, number>, item: any) => {
            acc[item._id || 'unknown'] = item.count;
            return acc;
          },
          {},
        ),
        bySource: bySource.reduce((acc: Record<string, number>, item: any) => {
          acc[item._id || 'unknown'] = item.count;
          return acc;
        }, {}),
        avgConfidence: stats[0]?.avgConfidence || 0,
        avgUsage: stats[0]?.avgUsage || 0,
        recentlyAdded,
      };
    } catch (error) {
      console.error('[KnowledgeTraining] Error getting stats:', error);
      return {
        totalEntries: 0,
        byCategory: {},
        bySource: {},
        avgConfidence: 0,
        avgUsage: 0,
        recentlyAdded: 0,
      };
    }
  }

  /**
   * Delete knowledge entry
   */
  async deleteKnowledge(id: string): Promise<boolean> {
    try {
      const result = await KnowledgeEntry.findByIdAndDelete(id);
      if (result) {
        this.invalidateCache();
        return true;
      }
      return false;
    } catch (error) {
      console.error('[KnowledgeTraining] Error deleting knowledge:', error);
      return false;
    }
  }

  /**
   * Update knowledge entry
   */
  async updateKnowledge(
    id: string,
    updates: Partial<IKnowledgeEntry>,
  ): Promise<IKnowledgeEntry | null> {
    try {
      const entry = await KnowledgeEntry.findByIdAndUpdate(
        id,
        { ...updates, updatedAt: new Date() },
        { new: true },
      );

      if (entry) {
        this.invalidateCache();
      }

      return entry;
    } catch (error) {
      console.error('[KnowledgeTraining] Error updating knowledge:', error);
      return null;
    }
  }

  // Private helper methods

  private async refreshCacheIfNeeded(): Promise<void> {
    if (Date.now() - this.lastCacheRefresh > this.cacheTTL) {
      this.knowledgeCache.clear();
      this.lastCacheRefresh = Date.now();
    }
  }

  private invalidateCache(): void {
    this.knowledgeCache.clear();
    this.lastCacheRefresh = 0;
  }

  private detectLanguage(text: string): 'en' | 'si' | 'ta' | 'hi' | 'all' {
    if (/[\u0D80-\u0DFF]/.test(text)) return 'si';
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    if (/^[a-zA-Z0-9\s\p{P}]+$/u.test(text)) return 'en';
    return 'all';
  }

  private extractTags(text: string): string[] {
    // Extract potential tags from text
    const words = text.toLowerCase().split(/\s+/);
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'need',
      'dare',
      'ought',
      'used',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'as',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'under',
      'again',
      'further',
      'then',
      'once',
      'here',
      'there',
      'when',
      'where',
      'why',
      'how',
      'all',
      'each',
      'few',
      'more',
      'most',
      'other',
      'some',
      'such',
      'no',
      'nor',
      'not',
      'only',
      'own',
      'same',
      'so',
      'than',
      'too',
      'very',
      's',
      't',
      'can',
      'will',
      'just',
      'don',
      'should',
      'now',
      'i',
      'me',
      'my',
      'myself',
      'we',
      'our',
      'ours',
      'ourselves',
      'you',
      'your',
      'yours',
      'yourself',
      'yourselves',
      'he',
      'him',
      'his',
      'himself',
      'she',
      'her',
      'hers',
      'herself',
      'it',
      'its',
      'itself',
      'they',
      'them',
      'their',
      'theirs',
      'themselves',
      'what',
      'which',
      'who',
      'whom',
      'this',
      'that',
      'these',
      'those',
      'am',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'having',
      'do',
      'does',
      'did',
      'doing',
      'and',
      'but',
      'if',
      'or',
      'because',
      'until',
      'while',
      'about',
      'against',
      'between',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'up',
      'down',
      'out',
      'off',
      'over',
      'under',
      'again',
      'further',
      'then',
      'once',
    ]);

    return words
      .filter((word) => word.length > 3 && !stopWords.has(word))
      .slice(0, 5);
  }

  private parseQAText(
    text: string,
  ): Array<{ question: string; answer: string }> {
    const pairs: Array<{ question: string; answer: string }> = [];
    const lines = text.split('\n');
    let currentQuestion = '';
    let currentAnswer = '';

    for (const line of lines) {
      if (line.startsWith('Q:') || line.startsWith('Question:')) {
        if (currentQuestion && currentAnswer) {
          pairs.push({
            question: currentQuestion.trim(),
            answer: currentAnswer.trim(),
          });
        }
        currentQuestion = line.replace(/^(Q:|Question:)\s*/, '');
        currentAnswer = '';
      } else if (line.startsWith('A:') || line.startsWith('Answer:')) {
        currentAnswer = line.replace(/^(A:|Answer:)\s*/, '');
      } else if (currentQuestion && !currentAnswer) {
        currentQuestion += ' ' + line;
      } else if (currentAnswer) {
        currentAnswer += ' ' + line;
      }
    }

    if (currentQuestion && currentAnswer) {
      pairs.push({
        question: currentQuestion.trim(),
        answer: currentAnswer.trim(),
      });
    }

    return pairs;
  }
}

export const knowledgeTrainingService = KnowledgeTrainingService.getInstance();
export default knowledgeTrainingService;
