import Config from '../models/Config';

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
