import Config from '../models/Config';
import { GEMINI_DEFAULT_MODEL } from '../config/brand';

/**
 * Gemini model names Google has RETIRED. A request to any of these returns
 * HTTP 404 ("model not found") on every call, which silently collapses the
 * entire AI chain into the lead-fallback template ("we'll get back to you
 * shortly…") for every user. Keep this list current with
 * https://ai.google.dev/gemini-api/docs/deprecations.
 *
 * As of 2026-06: all gemini-1.0*, gemini-1.5*, gemini-2.0* names and the
 * legacy gemini-pro / gemini-pro-vision aliases are shut down.
 */
const DEPRECATED_GEMINI_MODEL_PATTERNS: RegExp[] = [
  /^gemini-1\.0/i,
  /^gemini-1\.5/i,
  /^gemini-2\.0/i,
  /^gemini-pro$/i,
  /^gemini-pro-vision$/i,
  /^gemini-pro-latest$/i,
];

export function isDeprecatedGeminiModel(
  model: string | undefined | null,
): boolean {
  if (!model) return false;
  return DEPRECATED_GEMINI_MODEL_PATTERNS.some((re) => re.test(model.trim()));
}

/**
 * Gemini model generations that are PAID-ONLY / preview as of 2026-06.
 * Unlike retired models (which 404), these return HTTP 429 ("Too Many
 * Requests" with a zero/near-zero quota) on a FREE-TIER API key — which looks
 * identical to the retired-model failure to the customer: every reply
 * collapses into the canned lead-fallback template.
 *
 * The free tier only serves the gemini-2.5-* family. The whole 3.x line
 * (gemini-3.0*, gemini-3.5*, …) requires billing. See
 * https://ai.google.dev/gemini-api/docs/rate-limits.
 */
const PAID_ONLY_GEMINI_MODEL_PATTERNS: RegExp[] = [/^gemini-3(\.\d+)?[-.]/i];

export function isPaidOnlyGeminiModel(
  model: string | undefined | null,
): boolean {
  if (!model) return false;
  return PAID_ONLY_GEMINI_MODEL_PATTERNS.some((re) => re.test(model.trim()));
}

/**
 * Self-heal AI provider configs whose pinned model would fail on this
 * deployment's API key:
 *   - RETIRED models (1.5/2.0/pro) → 404 on every call.
 *   - PAID-ONLY 3.x models on a free-tier key → 429 on every call.
 *
 * Both silently collapse the AI chain into the "we'll get back to you
 * shortly…" template. Because the DB value overrides the code default, a
 * redeploy alone won't help — this rewrites the stored model to
 * GEMINI_DEFAULT_MODEL on boot so production fixes itself with no admin action.
 *
 * The paid-only rewrite is SKIPPED when the model already equals
 * GEMINI_DEFAULT_MODEL: that is the explicit escape hatch for a paying
 * operator who deliberately wants 3.x — they set
 * `GEMINI_DEFAULT_MODEL=gemini-3.5-flash` and the migration leaves it alone.
 *
 * Idempotent: once rewritten the rows no longer match and are skipped.
 */
export async function migrateDeprecatedAIModels(): Promise<void> {
  try {
    const googleProviders = await Config.find({
      isProvider: true,
      providerType: 'google',
    });

    let migrated = 0;
    for (const provider of googleProviders) {
      const current = (provider as any).aiModel as string | undefined;
      const retired = isDeprecatedGeminiModel(current);
      const paidOnly =
        isPaidOnlyGeminiModel(current) && current !== GEMINI_DEFAULT_MODEL;
      if (retired || paidOnly) {
        (provider as any).aiModel = GEMINI_DEFAULT_MODEL;
        await provider.save();
        migrated++;
        const reason = retired
          ? 'retired (404)'
          : 'paid-only/preview — 429 on free-tier keys';
        console.warn(
          `🔧 Migrated Gemini model "${current}" → "${GEMINI_DEFAULT_MODEL}" [${reason}] ` +
            `(Config _id=${String((provider as any)._id)}). Set GEMINI_DEFAULT_MODEL to override.`,
        );
      }
    }

    if (migrated > 0) {
      console.log(
        `✅ AI model migration: updated ${migrated} provider(s) to a supported Gemini model.`,
      );
    }
  } catch (err) {
    console.error('⚠️ AI model migration failed:', err);
  }
}

/**
 * Seeds essential configuration defaults on server startup.
 * AI Providers are NOT automatically created - admins must create them through the UI.
 */
export async function seedAIProviders(): Promise<void> {
  console.log('🌱 Checking essential configurations...');

  // Seed LOCAL_NLP_ENABLED config if it doesn't exist
  const localNLPConfig = await Config.findOne({ key: 'LOCAL_NLP_ENABLED' });
  if (!localNLPConfig) {
    await Config.create({
      key: 'LOCAL_NLP_ENABLED',
      value: 'false',
      description:
        'Enables Auto-Learning Local NLP Caching to save API Tokens. When enabled, common queries are cached locally.',
      isProvider: false,
      isActive: true,
    });
    console.log(
      '   ✅ Created LOCAL_NLP_ENABLED configuration (default: disabled)',
    );
  }

  console.log('🌱 Configuration seeding complete.');
  console.log(
    '   ℹ️ AI Providers can be added via Admin Panel > Configuration.',
  );
}
