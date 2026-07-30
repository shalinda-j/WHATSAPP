import Dataset from '../models/Dataset';
import KnowledgeEntry from '../models/KnowledgeEntry';

/**
 * Kiosk-scoped dataset + personalisation layer.
 *
 * The kiosk used to borrow the WhatsApp bot's brain wholesale. Every consult
 * turn called `aiLoadBalancer.sendMessage`, whose system prompt is the global
 * `AI_PERSONALITY` plus `getKnowledgeBaseForAI()` — up to **100** knowledge
 * entries ordered by usage count, plus every dataset row. Three problems, all of
 * which a visitor standing at a terminal feels directly:
 *
 *  1. **Wrong content.** Most of that KB is the overseas-job-vacancy WhatsApp
 *     funnel. A branch enrollment terminal asking about course fees was
 *     competing with a hundred Q&As about visas.
 *  2. **Latency.** A voice loop is a person waiting in silence. Assembling a
 *     100-entry prompt — and re-reading the visitor's Lead row and last ten
 *     WhatsApp messages — on *every* utterance is time they spend watching a
 *     spinner.
 *  3. **Not operator-editable.** The kiosk consultant's whole personality was a
 *     hard-coded Sinhala string in the route, so changing its tone meant a
 *     redeploy, while the WhatsApp bot's lives in Admin → Datasets.
 *
 * So: a kiosk scope over the existing collections (no new models), relevance
 * ranking instead of a dump, and TTL caches sized to how often each thing can
 * actually change.
 *
 * Scoping uses fields that already exist:
 *   Dataset.scope         — 'KIOSK' for kiosk-only rows, 'ALL' stays shared
 *   KnowledgeEntry        — category 'kiosk' or a 'kiosk' tag
 * Nothing has to be migrated: with no kiosk-scoped rows at all this falls back
 * to the shared pool, so the kiosk behaves as it does today until an operator
 * starts curating.
 */

// ── Scope constants ─────────────────────────────────────────────────────────
export const KIOSK_DATASET_SCOPE = 'KIOSK';
export const SHARED_DATASET_SCOPE = 'ALL';
export const KIOSK_KNOWLEDGE_CATEGORY = 'kiosk';
export const KIOSK_PERSONALITY_KEY = 'KIOSK_PERSONALITY';

/**
 * How many knowledge entries reach the model per turn.
 *
 * Eight, not a hundred. Past roughly this point a bigger prompt stops adding
 * recall and starts adding latency and distraction — and the ranked tail is by
 * definition the least relevant material available.
 */
export const KIOSK_KB_LIMIT = 8;

/** Candidate pool pulled from Mongo before ranking happens in memory. */
const KB_POOL_SIZE = 200;

// ── Cache TTLs, each sized to what it protects ───────────────────────────────
/** Content an operator might be editing right now — short, so edits show up. */
const CONTENT_TTL_MS = 60 * 1000;
/**
 * A visitor's history and Lead profile, which cannot change during a visit.
 * Matches the 30-minute kiosk token, so one session reads it exactly once
 * instead of once per utterance.
 */
const VISITOR_TTL_MS = 30 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface RankableEntry {
  question: string;
  answer: string;
  category?: string;
  tags?: string[];
  confidence?: number;
  usageCount?: number;
}

/**
 * Words carrying no retrieval signal. Sinhala is largely left alone — it is
 * agglutinative, so trimming particles needs a real stemmer and a wrong guess
 * removes meaning. The few listed are unambiguous standalone function words.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'has',
  'have',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'want',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'will',
  'with',
  'you',
  'your',
  // Sinhala standalone function words
  'මම',
  'මට',
  'ඔබ',
  'ඔයා',
  'එක',
  'මේ',
  'ඒ',
  'සහ',
  'හෝ',
]);

/**
 * Split text into comparable tokens.
 *
 * Keeps Sinhala (U+0D80–U+0DFF) and Tamil (U+0B80–U+0BFF) alongside ASCII
 * alphanumerics, because a kiosk visitor speaks Sinhala, Singlish, or a mix
 * inside one sentence — a plain \w+ split would throw away most of the query.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return (text.toLowerCase().match(/[a-z0-9඀-෿஀-௿]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

/**
 * Relevance of one entry to the visitor's utterance.
 *
 * A question match counts for far more than an answer match: answers are long,
 * so a shared word there is often coincidence, whereas the question IS the
 * entry's topic. Tag hits sit in between — deliberately curated, but coarse.
 *
 * `confidence` and `usageCount` only break ties. They must not outrank lexical
 * overlap, which is exactly the bug in the old behaviour: sorting the whole KB
 * by `usageCount` handed the model the most POPULAR entries regardless of what
 * was actually asked.
 */
export function scoreEntry(
  queryTokens: readonly string[],
  entry: RankableEntry,
): number {
  if (queryTokens.length === 0) return 0;
  const q = new Set(queryTokens);
  const questionTokens = new Set(tokenize(entry.question));
  const answerTokens = new Set(tokenize(entry.answer));
  const tagTokens = new Set(
    (entry.tags ?? []).flatMap((t) => tokenize(String(t))),
  );

  let score = 0;
  for (const token of q) {
    if (questionTokens.has(token)) score += 3;
    if (tagTokens.has(token)) score += 2;
    if (answerTokens.has(token)) score += 1;
  }
  if (score === 0) return 0;

  // Normalise by query length so a long utterance doesn't inflate every score,
  // then add a sub-1 tiebreak so equally-relevant entries fall in a stable,
  // sensible order.
  const normalised = score / q.size;
  const confidence = Math.min(Math.max(entry.confidence ?? 1, 0), 1);
  const usage = Math.min(entry.usageCount ?? 0, 100) / 100;
  return normalised + confidence * 0.05 + usage * 0.02;
}

/** Highest-scoring entries for a query. Entries scoring zero are dropped. */
export function rankEntries<T extends RankableEntry>(
  query: string,
  entries: readonly T[],
  limit = KIOSK_KB_LIMIT,
): T[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    // Nothing to match on (e.g. the opening turn is just a greeting). Fall back
    // to the operator's own signal rather than returning nothing at all.
    return [...entries]
      .sort(
        (a, b) =>
          (b.confidence ?? 1) - (a.confidence ?? 1) ||
          (b.usageCount ?? 0) - (a.usageCount ?? 0),
      )
      .slice(0, limit);
  }
  return entries
    .map((entry) => ({ entry, score: scoreEntry(queryTokens, entry) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}

/** Render ranked entries as the Q/A block the rest of the app uses. */
export function formatKnowledgeBlock(
  entries: readonly RankableEntry[],
): string {
  if (entries.length === 0) return '';
  const body = entries
    .map((e) => `Q: ${e.question}\nA: ${e.answer}`)
    .join('\n\n');
  return `# Kiosk Knowledge Base (${entries.length} most relevant)\n\n${body}`;
}

/**
 * Built-in kiosk consultant personality.
 *
 * Lifted verbatim from the directive that was hard-coded in
 * src/server/routes/kiosk.ts so behaviour is unchanged when no operator row
 * exists. Create a Dataset row with key KIOSK_PERSONALITY to override it from
 * the admin panel.
 */
export const DEFAULT_KIOSK_PERSONALITY =
  `ඔබ ශාඛාවේ මිත්‍රශීලී මානව උපදේශකයෙක් — form එකක් පුරවන යන්ත්‍රයක් නොවේ. ` +
  `මෙය හඬ (voice) සංවාදයක්: සැබෑ මිනිසෙක් මෙන් උණුසුම්ව, ස්වාභාවිකව, කෙටියෙන් (වාක්‍ය 1–2ක්) කතා කරන්න. ` +
  `(1) පුද්ගලයාට අවශ්‍ය දේ ගැන ස්වාභාවික කතාබහක් කරන්න — ඔවුන්ගේ ඉලක්ක/ප්‍රශ්න ගැන කතා කර උදව් කරන්න. ` +
  `(2) අවශ්‍ය තොරතුරු එක එක ප්‍රශ්න විදිහට යාන්ත්‍රිකව අහන්න එපා — කතාව අතරතුර ස්වාභාවිකව, මෘදුව අහගන්න. ` +
  `(3) පාඨමාලා/මට්ටම්/ගාස්තු විස්තර දැනුම් පදනමෙන් (KB) පමණක් — කිසිවක් මනක්කල්පිත නොකරන්න. ` +
  `(4) පළමුව පුද්ගලයාගේ හැඟීම හඳුනාගෙන ඒකට react කරන්න. ` +
  `(You are a warm HUMAN consultant at a branch, NOT a form-filling robot. This is a VOICE chat: ` +
  `talk like a real person — natural, warm, short (1–2 sentences). Course/fee facts ONLY from the ` +
  `knowledge base; never invent them. Read the visitor's emotion first and react to it.)`;

class KioskDatasetService {
  private kbPool = new Map<string, CacheEntry<RankableEntry[]>>();
  private personality = new Map<string, CacheEntry<string>>();
  private visitors = new Map<string, CacheEntry<string>>();

  private read<T>(
    store: Map<string, CacheEntry<T>>,
    key: string,
  ): T | undefined {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  private write<T>(
    store: Map<string, CacheEntry<T>>,
    key: string,
    value: T,
    ttl: number,
  ): T {
    store.set(key, { value, expiresAt: Date.now() + ttl });
    return value;
  }

  /**
   * Legacy-tolerant tenant clause, matching the convention used across the app:
   * rows written before tenants existed have no tenantId and must stay visible.
   */
  private tenantClause(tenantId?: string): Record<string, unknown> | null {
    if (!tenantId) return null;
    return {
      $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: null }],
    };
  }

  /**
   * Candidate knowledge pool for the kiosk, cached briefly.
   *
   * Prefers entries an operator has explicitly marked for the kiosk (category
   * 'kiosk' or a 'kiosk' tag). If there are none — the state of every existing
   * deployment — it falls back to the shared pool so the kiosk keeps answering
   * while the operator curates.
   */
  async getKnowledgePool(tenantId?: string): Promise<RankableEntry[]> {
    const key = `kb:${tenantId || 'global'}`;
    const cached = this.read(this.kbPool, key);
    if (cached) return cached;

    const tenant = this.tenantClause(tenantId);
    const select = 'question answer category tags confidence usageCount';

    const load = async (
      extra: Record<string, unknown>,
    ): Promise<RankableEntry[]> => {
      const filter: Record<string, unknown> = { isActive: true, ...extra };
      const query = tenant ? { $and: [filter, tenant] } : filter;
      const rows = await KnowledgeEntry.find(query as never)
        .sort({ usageCount: -1, confidence: -1 })
        .limit(KB_POOL_SIZE)
        .select(select)
        .lean();
      return (rows as unknown as RankableEntry[]) ?? [];
    };

    try {
      let pool = await load({
        $or: [{ category: KIOSK_KNOWLEDGE_CATEGORY }, { tags: 'kiosk' }],
      });
      if (pool.length === 0) pool = await load({});
      return this.write(this.kbPool, key, pool, CONTENT_TTL_MS);
    } catch (err) {
      console.warn(
        '⚠️ kiosk knowledge pool load failed:',
        (err as Error)?.message || err,
      );
      // Cache the empty result too, so a Mongo outage doesn't mean a failed
      // query on every single utterance of every session.
      return this.write(this.kbPool, key, [], CONTENT_TTL_MS);
    }
  }

  /**
   * Kiosk consultant personality — the operator's Dataset row when present,
   * otherwise the built-in default so behaviour never depends on seeding.
   */
  async getPersonality(tenantId?: string): Promise<string> {
    const key = `persona:${tenantId || 'global'}`;
    const cached = this.read(this.personality, key);
    if (cached) return cached;

    try {
      const tenant = this.tenantClause(tenantId);
      const base = { key: KIOSK_PERSONALITY_KEY, isActive: true };
      const row: unknown = await Dataset.findOne(
        (tenant ? { $and: [base, tenant] } : base) as never,
      )
        .select('content')
        .lean();
      const text = extractDatasetText((row as { content?: unknown })?.content);
      return this.write(
        this.personality,
        key,
        text || DEFAULT_KIOSK_PERSONALITY,
        CONTENT_TTL_MS,
      );
    } catch (err) {
      console.warn(
        '⚠️ kiosk personality load failed:',
        (err as Error)?.message || err,
      );
      return this.write(
        this.personality,
        key,
        DEFAULT_KIOSK_PERSONALITY,
        CONTENT_TTL_MS,
      );
    }
  }

  /**
   * The kiosk's system prompt: its own personality plus only the knowledge that
   * bears on what the visitor just said.
   *
   * Passed to `aiLoadBalancer.sendMessage` as `systemContentOverride`, which is
   * what stops the global 100-entry WhatsApp KB from being assembled and sent
   * alongside it.
   */
  async getSystemContent(query: string, tenantId?: string): Promise<string> {
    const [persona, pool] = await Promise.all([
      this.getPersonality(tenantId),
      this.getKnowledgePool(tenantId),
    ]);
    const block = formatKnowledgeBlock(rankEntries(query, pool));
    return block ? `${persona}\n\n${block}` : persona;
  }

  /**
   * Visitor background (Lead profile + recent WhatsApp turns), cached for the
   * life of the session.
   *
   * This is the single biggest latency win in the consult loop. The underlying
   * reads — a Lead lookup and the last ten ChatMessages — cannot change while
   * somebody is standing at the terminal, yet they ran on every utterance and
   * produced a byte-identical string each time.
   *
   * Takes a loader rather than doing the queries itself so the route keeps
   * ownership of how a visitor is resolved (phone-tail matching, @lid privacy
   * JIDs, tenant scoping) and this stays a caching concern.
   */
  async getVisitorProfile(
    inviteId: string,
    loader: () => Promise<string>,
  ): Promise<string> {
    if (!inviteId) return loader();
    const cached = this.read(this.visitors, inviteId);
    if (cached !== undefined) return cached;
    let value = '';
    try {
      value = await loader();
    } catch (err) {
      console.warn(
        '⚠️ kiosk visitor profile load failed:',
        (err as Error)?.message || err,
      );
      value = '';
    }
    return this.write(this.visitors, inviteId, value, VISITOR_TTL_MS);
  }

  /** Drop a finished session's cached profile (session end / conversion). */
  invalidateVisitor(inviteId: string): void {
    this.visitors.delete(inviteId);
  }

  /** Drop cached kiosk content — call after an operator edits a dataset row. */
  invalidateContent(): void {
    this.kbPool.clear();
    this.personality.clear();
  }

  /** Test seam: wipe every cache. */
  clearAll(): void {
    this.invalidateContent();
    this.visitors.clear();
  }
}

/**
 * Pull display text out of a Dataset `content` field.
 *
 * `content` is Mixed: either a plain string or the multi-language
 * `{ si, en, ta }` shape. The kiosk speaks Sinhala first, so prefer `si` and
 * fall back through the other languages rather than rendering "[object Object]"
 * into the system prompt.
 */
export function extractDatasetText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  if (typeof content === 'object') {
    const c = content as Record<string, unknown>;
    for (const lang of ['si', 'en', 'ta']) {
      const v = c[lang];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

export const kioskDatasetService = new KioskDatasetService();
export default kioskDatasetService;
