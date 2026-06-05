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
 * IMPORTANT — keep this current. Google retires Gemini models on a rolling
 * schedule and a retired name returns HTTP 404 on EVERY call, which silently
 * collapses the whole AI chain into the lead-fallback template. As of
 * 2026-06: gemini-1.5* and gemini-2.0* are SHUT DOWN. Valid: gemini-2.5-flash,
 * gemini-2.5-flash-lite, gemini-2.5-pro, gemini-3.5-flash. See
 * DEPRECATED_GEMINI_MODEL_PATTERNS in AIProviderSeeder for the self-heal list.
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
