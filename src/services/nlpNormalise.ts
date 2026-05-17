/**
 * Locale-aware utterance normaliser for the Local NLP Cache.
 *
 * The cache's job is to recognise that two user inputs mean the same thing
 * even when the surface text differs (different casing, stray punctuation,
 * extra whitespace, Sinhala/Tamil morphological suffixes). node-nlp can do
 * some of this for English, but Sinhala/Tamil aren't supported natively —
 * if we hand it raw "මිල කීයද?" vs "මිල කොච්චරද" it sees them as totally
 * unrelated tokens and the cache misses.
 *
 * This module produces a *canonical* form per utterance that the matching
 * layer indexes on. Strategy:
 *   1. Lowercase Latin letters.
 *   2. Strip punctuation that doesn't change meaning (?, !, ., ,, ;, :).
 *   3. Collapse runs of whitespace.
 *   4. Strip common Sinhala question suffixes (ද, දෝ, ද? etc.) which are
 *      noise from a similarity standpoint.
 *   5. Strip common Tamil question particles.
 *   6. Leave non-Latin characters intact (Sinhala/Tamil/Hindi unicode).
 *
 * The canonical form is what we store in `NLPCache.canonicalUtterances`
 * and what we compare against on lookup.
 */

export type DetectedLang = 'en' | 'si' | 'ta' | 'hi' | 'mixed';

/** Unicode ranges we explicitly recognise. */
const SINHALA_RANGE = /[඀-෿]/;
const TAMIL_RANGE = /[஀-௿]/;
const HINDI_RANGE = /[ऀ-ॿ]/;

export function detectLanguage(text: string): DetectedLang {
  if (!text) return 'en';
  const hasSi = SINHALA_RANGE.test(text);
  const hasTa = TAMIL_RANGE.test(text);
  const hasHi = HINDI_RANGE.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  const flags = [hasSi, hasTa, hasHi, hasLatin].filter(Boolean).length;
  if (flags > 1) return 'mixed';
  if (hasSi) return 'si';
  if (hasTa) return 'ta';
  if (hasHi) return 'hi';
  return 'en';
}

// Sinhala question / politeness suffixes that don't change semantics.
// "මිල කීයද?" → "මිල කී"; "ඔයාගේ වෙලාව මොකද්ද?" → "ඔයාගේ වෙලාව මොක".
// Conservative list — only the highest-frequency endings.
const SI_SUFFIXES = [
  'ද\\?', 'ද$',
  'දෝ\\?', 'දෝ$',
  'ද්ද\\?', 'ද්ද$',
  'යි$',
];
const SI_SUFFIX_REGEX = new RegExp(`(?:${SI_SUFFIXES.join('|')})`, 'g');

// Tamil question particles.
const TA_SUFFIXES = ['ஆ\\?', 'ஆ$', 'ஏ\\?', 'ஏ$', 'என்ன$'];
const TA_SUFFIX_REGEX = new RegExp(`(?:${TA_SUFFIXES.join('|')})`, 'g');

// Punctuation that we treat as meaning-less for cache matching.
const STRIP_PUNCT = /[?!.,;:"'`()[\]{}—–…\-]/g;

export function normaliseUtterance(input: string): string {
  if (!input) return '';
  let s = input.trim();
  // Lowercase Latin only — leaves Sinhala/Tamil unicode untouched (those
  // scripts don't have case).
  s = s.toLowerCase();
  // Strip the common question suffixes per language.
  s = s.replace(SI_SUFFIX_REGEX, '');
  s = s.replace(TA_SUFFIX_REGEX, '');
  // Strip benign punctuation.
  s = s.replace(STRIP_PUNCT, ' ');
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Quick exact-canonical lookup helper used by both processMessage and
 * learnFromAI to decide whether two utterances should be treated as the
 * same. Cheaper than running them through node-nlp's classifier.
 */
export function canonicalMatch(a: string, b: string): boolean {
  return (
    normaliseUtterance(a) === normaliseUtterance(b) &&
    normaliseUtterance(a).length > 0
  );
}
