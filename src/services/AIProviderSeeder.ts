import Config from '../models/Config';
import { GEMINI_DEFAULT_MODEL } from '../config/brand';
import {
  isDeprecatedGeminiModel,
  isPaidOnlyGeminiModel,
} from '../config/geminiModels';

// Re-export the pure model-policy helpers so existing importers/tests that
// reference them from this module keep working. The source of truth (and the
// runtime coercion used on the hot path) lives in ../config/geminiModels.
export { isDeprecatedGeminiModel, isPaidOnlyGeminiModel };

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
