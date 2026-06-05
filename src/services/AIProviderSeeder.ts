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
 * Self-heal AI provider configs whose pinned model has been retired by Google.
 *
 * Without this, a deployment whose Admin Panel still stores e.g.
 * "gemini-1.5-flash" keeps 404-ing on every message even after the code
 * default is bumped — because the DB value overrides the code default. This
 * rewrites any retired Google model to GEMINI_DEFAULT_MODEL on boot, so a
 * redeploy fixes production with no manual admin action.
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
      if (isDeprecatedGeminiModel(current)) {
        (provider as any).aiModel = GEMINI_DEFAULT_MODEL;
        await provider.save();
        migrated++;
        console.warn(
          `🔧 Migrated retired Gemini model "${current}" → "${GEMINI_DEFAULT_MODEL}" ` +
            `(Config _id=${String((provider as any)._id)}). Set GEMINI_DEFAULT_MODEL to override.`,
        );
      }
    }

    if (migrated > 0) {
      console.log(
        `✅ AI model migration: updated ${migrated} provider(s) off retired Gemini models.`,
      );
    }
  } catch (err) {
    console.error('⚠️ Deprecated AI model migration failed:', err);
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
