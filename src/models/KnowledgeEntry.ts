import mongoose from 'mongoose';

/**
 * KnowledgeEntry Model
 * Stores individual knowledge items for AI training
 * Supports categories, tags, and automatic learning
 */

export interface IKnowledgeEntry {
  question: string;
  answer: string;
  category: string;
  tags: string[];
  source: 'manual' | 'conversation' | 'document' | 'import';
  confidence: number;
  usageCount: number;
  isActive: boolean;
  language: 'en' | 'si' | 'ta' | 'hi' | 'all';
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

const KnowledgeEntrySchema = new (mongoose as any).Schema({
  question: {
    type: String,
    required: true,
    index: true,
  },
  answer: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    default: 'general',
    index: true,
  },
  tags: [
    {
      type: String,
      index: true,
    },
  ],
  source: {
    type: String,
    enum: ['manual', 'conversation', 'document', 'import'],
    default: 'manual',
  },
  confidence: {
    type: Number,
    default: 1.0,
    min: 0,
    max: 1,
  },
  usageCount: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  language: {
    type: String,
    enum: ['en', 'si', 'ta', 'hi', 'all'],
    default: 'all',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  lastUsedAt: {
    type: Date,
  },
});

// Text search index for question matching
KnowledgeEntrySchema.index({ question: 'text', tags: 'text' });

// Compound index for active entries by category
KnowledgeEntrySchema.index({ isActive: 1, category: 1 });

const KnowledgeEntry =
  mongoose.models.KnowledgeEntry ||
  (mongoose as any).model('KnowledgeEntry', KnowledgeEntrySchema);

export default KnowledgeEntry;
