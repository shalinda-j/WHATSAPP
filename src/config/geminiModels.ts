/**
 * Pure Gemini model-name policy — NO side effects, NO DB/mongoose imports, so
 * it is safe to use anywhere (including the hot request path) without circular
 * imports.
 *
 * Two failure classes turn a wrong model name into the "we'll get back to you
 * shortly" canned auto-reply for EVERY user:
 *   - RETIRED models  → HTTP 404 on every call (gemini-1.0/1.5/2.0, legacy pro).
 *   - PAID-ONLY/preview models → HTTP 429 on every call with a FREE-TIER key
 *     (the whole gemini-3.x line as of 2026-06).
 *
 * The boot migration (AIProviderSeeder) rewrites bad models stored in the DB,
 * but that only helps once it has run and the DB write succeeded. The runtime
 * coercion here is the belt-and-braces guarantee: every Gemini call passes the
 * model through coerceToSupportedGeminiModel() first, so a stale DB value can
 * never reach the API.
 */
import { GEMINI_DEFAULT_MODEL } from './brand';

/** Retired Gemini models — 404 on every call. */
export const DEPRECATED_GEMINI_MODEL_PATTERNS: RegExp[] = [
  /^gemini-1\.0/i,
  /^gemini-1\.5/i,
  /^gemini-2\.0/i,
  /^gemini-pro$/i,
  /^gemini-pro-vision$/i,
  /^gemini-pro-latest$/i,
];

/**
 * Paid-only / preview generations. A free-tier key 429s on every call. The
 * whole 3.x line is paid-only as of 2026-06.
 */
export const PAID_ONLY_GEMINI_MODEL_PATTERNS: RegExp[] = [
  /^gemini-3(\.\d+)?[-.]/i,
];

export function isDeprecatedGeminiModel(
  model: string | undefined | null,
): boolean {
  if (!model) return false;
  return DEPRECATED_GEMINI_MODEL_PATTERNS.some((re) => re.test(model.trim()));
}

export function isPaidOnlyGeminiModel(
  model: string | undefined | null,
): boolean {
  if (!model) return false;
  return PAID_ONLY_GEMINI_MODEL_PATTERNS.some((re) => re.test(model.trim()));
}

/**
 * Return a model that is safe to call on this deployment's key. Rewrites
 * retired and paid-only-on-free-tier models to GEMINI_DEFAULT_MODEL.
 *
 * Escape hatch: a paid operator who deliberately wants 3.x sets
 * GEMINI_DEFAULT_MODEL=gemini-3.5-flash; then the requested model equals the
 * default and is left untouched.
 */
export function coerceToSupportedGeminiModel(
  model: string | undefined | null,
): string {
  const m = (model ?? '').trim();
  if (!m) return GEMINI_DEFAULT_MODEL;
  if (isDeprecatedGeminiModel(m)) return GEMINI_DEFAULT_MODEL;
  if (isPaidOnlyGeminiModel(m) && m !== GEMINI_DEFAULT_MODEL) {
    return GEMINI_DEFAULT_MODEL;
  }
  return m;
}
