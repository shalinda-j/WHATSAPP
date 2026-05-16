/**
 * Retrieval-Augmented Generation service for agents.
 *
 * Maintains embeddings for AgentTrainingExample rows and returns the top-K
 * most similar examples for a given query. Falls back to keyword matching
 * when no embedding provider is configured so the system stays functional
 * out-of-the-box.
 *
 * Storage: embeddings live on the AgentTrainingExample document itself
 * (Mongo array). Cosine similarity is computed in-memory — fine to ~10k
 * examples per agent; swap for pgvector / Atlas Vector Search when we
 * outgrow it (interface stays identical).
 */

import OpenAI from 'openai';
import AgentTrainingExample, {
  IAgentTrainingExample,
} from '../models/AgentTrainingExample';

export interface RetrievedExample {
  input: string;
  expectedOutput: string;
  tags: string[];
  similarity: number;
  source: 'embedding' | 'keyword';
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
/** OpenAI text-embedding-3-small returns 1536-dim vectors. */
const EXPECTED_DIM = 1536;

class AgentRAGService {
  private openai: OpenAI | null = null;

  private getClient(): OpenAI | null {
    if (!process.env.OPENAI_API_KEY) return null;
    if (!this.openai) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this.openai;
  }

  isEmbeddingReady(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  /**
   * Compute an embedding for a single piece of text. Returns null if no
   * embedding provider is configured — callers should treat that as the
   * cue to fall back to keyword retrieval.
   */
  async embedText(text: string): Promise<number[] | null> {
    const client = this.getClient();
    if (!client) return null;
    const cleaned = text.trim().slice(0, 8000); // safe cap; the API allows ~8191 tokens
    if (!cleaned) return null;
    try {
      const res = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: cleaned,
      });
      return res.data[0]?.embedding ?? null;
    } catch (err) {
      console.error('embedText failed:', err);
      return null;
    }
  }

  /**
   * Ensure an example row has a fresh embedding. Called on create + on
   * batch re-index. No-op when the model already has an embedding for the
   * current model id.
   */
  async indexExample(exampleId: string): Promise<boolean> {
    const ex = await AgentTrainingExample.findById(exampleId);
    if (!ex) return false;
    if (
      ex.embedding &&
      ex.embedding.length === EXPECTED_DIM &&
      ex.embeddingModel === EMBEDDING_MODEL
    ) {
      return true; // already indexed
    }
    // Embed on `input + expectedOutput` — retrieval still keys on `input`,
    // but combining adds robustness when input is short or generic.
    const text = `${ex.input}\n\n${ex.expectedOutput}`;
    const vec = await this.embedText(text);
    if (!vec) return false;
    ex.embedding = vec;
    ex.embeddingModel = EMBEDDING_MODEL;
    ex.embeddedAt = new Date();
    await ex.save();
    return true;
  }

  /**
   * Top-K retrieval. Pulls all active examples for the agent+tenant scope
   * (bounded by the agent's example count which is operator-controlled) and
   * scores them against the query.
   */
  async retrieveExamples(opts: {
    tenantId: string;
    agentName: string;
    query: string;
    topK?: number;
  }): Promise<RetrievedExample[]> {
    const topK = Math.max(1, Math.min(opts.topK ?? 3, 10));

    const candidates = await AgentTrainingExample.find({
      tenantId: opts.tenantId,
      agentName: opts.agentName,
      isActive: true,
    })
      .limit(2000) // safety cap; if you hit this, time to switch to a real vector store
      .lean();

    if (candidates.length === 0) return [];

    // Embedding path
    const queryVec = await this.embedText(opts.query);
    if (queryVec) {
      const scored = candidates
        .filter(
          (c: any) =>
            Array.isArray(c.embedding) && c.embedding.length === queryVec.length,
        )
        .map((c: any) => ({
          example: c as IAgentTrainingExample,
          score: cosineSimilarity(queryVec, c.embedding as number[]),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      if (scored.length > 0) {
        return scored.map((s) => ({
          input: s.example.input,
          expectedOutput: s.example.expectedOutput,
          tags: s.example.tags ?? [],
          similarity: s.score,
          source: 'embedding' as const,
        }));
      }
      // fall through to keyword if no example had an embedding yet
    }

    // Keyword fallback — naive overlap scoring, still useful as a
    // bootstrap when the operator hasn't run an index pass yet.
    const queryTokens = tokenize(opts.query);
    if (queryTokens.size === 0) return [];

    const scored = candidates
      .map((c: any) => {
        const exampleTokens = tokenize(c.input ?? '');
        let overlap = 0;
        for (const t of queryTokens) if (exampleTokens.has(t)) overlap++;
        return {
          example: c as IAgentTrainingExample,
          score: overlap / Math.max(queryTokens.size, exampleTokens.size, 1),
        };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map((s) => ({
      input: s.example.input,
      expectedOutput: s.example.expectedOutput,
      tags: s.example.tags ?? [],
      similarity: s.score,
      source: 'keyword' as const,
    }));
  }

  /**
   * Format retrieved examples into a prompt-friendly block that agents can
   * inject into their system message. Returns empty string when nothing
   * relevant was found, so callers can safely concatenate.
   */
  formatForPrompt(examples: RetrievedExample[]): string {
    if (examples.length === 0) return '';
    const lines = examples.map(
      (e, i) =>
        `Example ${i + 1}${e.tags.length ? ` [${e.tags.join(', ')}]` : ''}\n` +
        `User: ${e.input}\n` +
        `Ideal reply: ${e.expectedOutput}`,
    );
    return [
      '## Relevant past examples',
      'Use these as a guide for tone and content. Do not copy verbatim — adapt to the current user and context.',
      ...lines,
    ].join('\n\n');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
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

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

export const agentRAGService = new AgentRAGService();
