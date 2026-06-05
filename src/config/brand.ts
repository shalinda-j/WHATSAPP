/**
 * Centralised brand + locale defaults.
 *
 * Finding #68: brand name, default country code and the country-interest list
 * used to be hardcoded across index.ts, LidPhoneMappingService.ts,
 * whatsapp.ts and gemini.ts. They are consolidated here so a deployment can
 * override them via environment variables WITHOUT a per-tenant refactor.
 *
 * IMPORTANT: the defaults below are the EXACT current production values, so a
 * default deployment (no env overrides) behaves identically to before.
 */

/** Default market country dialing code (Sri Lanka). Override: DEFAULT_COUNTRY_CODE. */
export const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '94';

/**
 * Default Google Gemini model used when a provider config does not pin one.
 * Override: GEMINI_DEFAULT_MODEL.
 *
 * IMPORTANT — keep this current. A wrong model name silently collapses the
 * whole AI chain into the "we'll get back to you shortly" lead-fallback
 * template. Two failure modes:
 *   - RETIRED models return HTTP 404 on every call. As of 2026-06
 *     gemini-1.5* and gemini-2.0* are SHUT DOWN.
 *   - PAID-ONLY / preview models return HTTP 429 on a FREE-TIER key. The
 *     entire gemini-3.x line (incl. gemini-3.5-flash) is paid-only as of
 *     2026-06 — do NOT pin it unless you have billing enabled AND set
 *     GEMINI_DEFAULT_MODEL=gemini-3.5-flash (the migration's escape hatch).
 *
 * Valid on the FREE tier: gemini-2.5-flash (10 rpm / 250-day),
 * gemini-2.5-flash-lite (15 rpm / 1000-day), gemini-2.5-pro (5 rpm / 100-day).
 * See AIProviderSeeder (DEPRECATED_/PAID_ONLY_GEMINI_MODEL_PATTERNS) for the
 * boot-time self-heal that rewrites a bad stored model to this default.
 */
export const GEMINI_DEFAULT_MODEL =
  process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash';

/** Brand display name used for the WhatsApp device label. Override: BRAND_NAME. */
export const BRAND_NAME = process.env.BRAND_NAME || 'Jayalath Global AI';

/** Sinhala welcome greeting used by the Gemini chat session. Override: BRAND_NAME_SI. */
export const BRAND_NAME_SI =
  process.env.BRAND_NAME_SI ||
  '🙏 ආයුබෝවන්! මම ජයලත් ග්ලොබල් AI - ඔබේ විදේශ රැකියා AI සහායකයා. මම ඔබට උදව් කරන්න සූදානම්!';

/**
 * Country / training-interest keywords used to tag inbound leads. Kept as the
 * exact current list; not env-overridable (regex literals), but co-located here
 * so it can be edited in one place.
 */
export const COUNTRY_INTERESTS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Japan', pattern: /\b(japan|japanese|jp)\b/i },
  { label: 'Israel', pattern: /\b(israel|isreal)\b/i },
  { label: 'Singapore', pattern: /\b(singapore|sg)\b/i },
  { label: 'Europe', pattern: /\b(europe|european)\b/i },
  { label: 'Korea', pattern: /\b(korea|korean)\b/i },
  { label: 'Romania', pattern: /\b(romania|romanian)\b/i },
  {
    label: 'Training course',
    pattern: /\b(course|training|welding|machinery|skill)\b/i,
  },
];
