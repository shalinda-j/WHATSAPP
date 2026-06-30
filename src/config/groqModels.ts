/**
 * Pure Groq model-name policy — NO side effects, NO DB/mongoose imports, so it
 * is safe to use anywhere (including the hot request path) without circular
 * imports. Mirrors src/config/geminiModels.ts.
 *
 * A decommissioned Groq model name 404s on every call. Because Groq is priority
 * 1 in the AILoadBalancer fallback chain, that makes the PRIMARY provider fail
 * on every message and forces a constant fall-over to Gemini (extra latency +
 * cost). The runtime coercion here is the belt-and-braces guarantee: every
 * GroqService instance passes its model through coerceToSupportedGroqModel()
 * first, so a stale DB value or the library default can never reach the API.
 */

/** A current, supported Groq production model. */
export const GROQ_DEFAULT_MODEL =
  process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/**
 * Retired / decommissioned Groq models — 404 on every call.
 *
 * NOTE on the `llama3-` prefix: all CURRENT Groq Llama models use the dotted
 * form 'llama-3.1-…' / 'llama-3.3-…' (i.e. they start with 'llama-3', not
 * 'llama3'). The original undotted 'llama3-8b-8192' / 'llama3-70b-8192'
 * production models AND the 'llama3-groq-*' tool-use previews are all retired,
 * so the broad /^llama3-/i pattern safely catches every retired undotted name
 * without touching a current 'llama-3.x' model.
 */
export const DECOMMISSIONED_GROQ_MODEL_PATTERNS: RegExp[] = [
  /^mixtral-8x7b/i, // decommissioned 2024
  /^llama2-70b/i, // decommissioned
  /^llama-3\.1-70b/i, // decommissioned (replaced by 3.3)
  /^gemma-7b/i, // decommissioned (replaced by gemma2-9b-it)
  /^llama3-/i, // retired undotted family: llama3-8b-8192, llama3-70b-8192, llama3-groq-*
];

export function isDecommissionedGroqModel(
  model: string | undefined | null,
): boolean {
  if (!model) return false;
  return DECOMMISSIONED_GROQ_MODEL_PATTERNS.some((re) => re.test(model.trim()));
}

/**
 * Return a model that is safe to call. Rewrites blank/decommissioned models to
 * GROQ_DEFAULT_MODEL; passes any other (current) model through untouched so an
 * operator can still pin a specific supported model.
 */
export function coerceToSupportedGroqModel(
  model: string | undefined | null,
): string {
  const m = (model ?? '').trim();
  if (!m) return GROQ_DEFAULT_MODEL;
  if (isDecommissionedGroqModel(m)) return GROQ_DEFAULT_MODEL;
  return m;
}
