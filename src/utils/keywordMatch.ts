/**
 * Whole-word / phrase keyword matcher for short conversational replies.
 *
 * Motivation: the booking flow used to test `keywords.includes(cleanText)`,
 * which required the WHOLE message to equal a keyword. A natural reply like
 * "Yes 9.30 vage anna hithan inna" ("Yes, planning to come around 9.30")
 * therefore failed the acceptance check and the booking was dropped. This
 * helper matches a keyword when it appears as a standalone token, so extra
 * words no longer break intent detection.
 *
 * - Single-word keywords match on a token boundary, so short tokens stay
 *   safe: 'y' never matches "why", 'ow' never matches "now".
 * - Multi-word keywords (e.g. "no thanks") fall back to a substring test.
 * - Matching is case-insensitive; punctuation and digits act as separators.
 */
export function messageMatchesKeyword(
  cleanText: string,
  keywords: string[],
): boolean {
  const text = (cleanText || '').trim().toLowerCase();
  if (!text) return false;
  const tokens = new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return keywords.some((raw) => {
    const kw = (raw || '').trim().toLowerCase();
    if (!kw) return false;
    return kw.includes(' ') ? text.includes(kw) : tokens.has(kw);
  });
}
