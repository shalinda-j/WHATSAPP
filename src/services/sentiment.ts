const POSITIVE = new Set([
  // English
  'good', 'great', 'excellent', 'amazing', 'awesome', 'love', 'loved', 'happy',
  'satisfied', 'perfect', 'thanks', 'thank', 'thankyou', 'helpful', 'nice',
  'best', 'fast', 'quick', 'wonderful', 'fantastic', 'super',
  // Sinhala phonetic
  'hodai', 'hodayi', 'hodama', 'patta', 'lassanai', 'pinkamak', 'apoo',
  'bohoma', 'stuti', 'praweena', 'usasai',
  // Tamil phonetic
  'nandri', 'arumai', 'nalla', 'nallavar',
]);

const NEGATIVE = new Set([
  // English
  'bad', 'worst', 'terrible', 'awful', 'hate', 'angry', 'frustrated', 'slow',
  'broken', 'useless', 'scam', 'fraud', 'fake', 'wrong', 'poor', 'rude',
  'unprofessional', 'disappointed', 'cheat', 'refund', 'complaint',
  // Sinhala phonetic
  'naraka', 'narakai', 'narak', 'epaa', 'epa', 'kunu', 'wedakata',
  // Tamil phonetic
  'mosham', 'kettavar', 'kashtam',
]);

const INTENSIFIERS = new Set([
  'very', 'really', 'super', 'extremely', 'so', 'too', 'so much',
  'bohoma', 'godak', 'godaakma', 'rohama',
]);

const NEGATORS = new Set(['not', "don't", 'dont', 'never', 'no', 'nope', 'epaa', 'epa']);

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface SentimentResult {
  score: number;
  label: SentimentLabel;
  /** Total tokens that contributed positive or negative weight. */
  matchedTerms: number;
}

/**
 * Lightweight rule-based sentiment scorer. Returns a score in [-1, 1] using a
 * keyword bag with intensifier (×1.5) and negation flip (×-1) lookbehind.
 *
 * Design choices:
 *  - Deterministic + zero-cost: runs inline on every inbound message without
 *    burning LLM tokens. The orchestrator can override with a model-based
 *    signal when the heuristic confidence is low (matchedTerms === 0).
 *  - Multilingual: covers English + Sinhala / Tamil phonetic forms (the
 *    same patterns intent classifier uses) so a Sinhala "naraka" message
 *    isn't silently labelled neutral.
 *  - Resilient to noise: very long messages and empty/whitespace inputs
 *    short-circuit to neutral so the heuristic can't mis-score essays.
 */
export function scoreSentiment(text: string | undefined | null): SentimentResult {
  if (!text || typeof text !== 'string') {
    return { score: 0, label: 'neutral', matchedTerms: 0 };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 4000) {
    return { score: 0, label: 'neutral', matchedTerms: 0 };
  }

  const tokens = trimmed
    .toLowerCase()
    .replace(/[.,!?;:'"()\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let raw = 0;
  let matched = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : '';
    const prev2 = i > 1 ? tokens[i - 2] : '';

    let weight = 0;
    if (POSITIVE.has(tok)) weight = 1;
    else if (NEGATIVE.has(tok)) weight = -1;
    else continue;

    matched++;
    if (INTENSIFIERS.has(prev) || INTENSIFIERS.has(prev2)) weight *= 1.5;
    if (NEGATORS.has(prev) || NEGATORS.has(prev2)) weight *= -1;
    raw += weight;
  }

  // Normalise to [-1, 1] using a saturating function so a single strong
  // signal doesn't dwarf longer mixed-tone messages.
  const score = Math.max(-1, Math.min(1, raw / 3));

  let label: SentimentLabel = 'neutral';
  if (score >= 0.2) label = 'positive';
  else if (score <= -0.2) label = 'negative';

  return { score: Number(score.toFixed(3)), label, matchedTerms: matched };
}
