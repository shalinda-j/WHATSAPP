import Config from '../models/Config';

/**
 * Seeds the database with AI providers based on configured API keys in .env
 * This runs once on server startup and ensures the Dashboard displays correct providers
 */
export async function seedAIProviders(): Promise<void> {
  console.log('🌱 Checking AI Provider configurations...');

  const providers = [
    {
      key: 'provider_gemini',
      envKey: 'GEMINI_API_KEY',
      providerType: 'google',
      aiModel: 'gemini-1.5-flash',
      description: 'Google Gemini AI (Primary)',
    },
    {
      key: 'provider_openai',
      envKey: 'OPENAI_API_KEY',
      providerType: 'openai',
      aiModel: 'gpt-4o-mini',
      description: 'OpenAI GPT',
    },
    {
      key: 'provider_groq',
      envKey: 'GROQ_API_KEY',
      providerType: 'groq',
      aiModel: 'llama3-8b-8192',
      description: 'Groq LLM',
    },
    {
      key: 'provider_openrouter',
      envKey: 'OPENROUTER_API_KEY',
      providerType: 'openrouter',
      aiModel: 'auto',
      description: 'OpenRouter Multi-Provider',
    },
  ];

  for (const p of providers) {
    const apiKey = process.env[p.envKey];

    if (apiKey && apiKey.length > 5) {
      // Provider is configured in .env, ensure it exists in DB
      const existing = await Config.findOne({ key: p.key });

      if (!existing) {
        await Config.create({
          key: p.key,
          value: '', // We don't store the actual key in DB for security
          description: p.description,
          isProvider: true,
          providerType: p.providerType,
          apiKey: '***configured***', // Just indicate it's set
          aiModel: p.aiModel,
          usageLimit: 0,
          usageUsed: 0,
          costPerToken: 0,
          isActive: true,
        });
        console.log(`   ✅ Registered AI Provider: ${p.providerType}`);
      } else {
        // Update existing to ensure it's active
        if (!existing.isActive) {
          existing.isActive = true;
          await existing.save();
          console.log(`   🔄 Re-activated AI Provider: ${p.providerType}`);
        }
      }
    } else {
      // Provider not configured, mark as inactive if it exists
      const existing = await Config.findOne({ key: p.key });
      if (existing && existing.isActive) {
        existing.isActive = false;
        await existing.save();
        console.log(
          `   ⚠️ Deactivated AI Provider (no API key): ${p.providerType}`,
        );
      }
    }
  }

  console.log('🌱 AI Provider seeding complete.');
}
