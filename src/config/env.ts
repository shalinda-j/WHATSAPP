/**
 * Environment Variable Validator
 * Validates all required environment variables at startup
 * Throws errors if critical variables are missing
 */

interface EnvRequirement {
  name: string;
  required: boolean;
  minLength?: number;
  description: string;
  defaultValue?: string;
}

const ENV_REQUIREMENTS: EnvRequirement[] = [
  // Critical - Application cannot start without these
  {
    name: 'JWT_SECRET',
    required: true,
    minLength: 32,
    description:
      'Secret key for JWT token signing. Must be at least 32 characters.',
  },
  {
    name: 'ENCRYPTION_KEY',
    required: true,
    minLength: 32,
    description:
      'AES-256 encryption key for API key storage. Must be exactly 32 characters.',
  },
  {
    name: 'MONGODB_URI',
    required: true,
    description: 'MongoDB connection string for data persistence.',
  },

  // Highly recommended - AI features won't work without at least one
  {
    name: 'GEMINI_API_KEY',
    required: false,
    description: 'Google Gemini AI API key (recommended primary provider).',
  },
  {
    name: 'OPENAI_API_KEY',
    required: false,
    description: 'OpenAI API key (fallback provider).',
  },
  {
    name: 'GROQ_API_KEY',
    required: false,
    description: 'Groq API key (fast response provider).',
  },
  {
    name: 'OPENROUTER_API_KEY',
    required: false,
    description: 'OpenRouter API key (alternative provider).',
  },

  // Optional - with defaults
  {
    name: 'PORT',
    required: false,
    defaultValue: '8080',
    description: 'Server port number.',
  },
  {
    name: 'NODE_ENV',
    required: false,
    defaultValue: 'development',
    description: 'Environment mode (development/production).',
  },

  // Optional features
  {
    name: 'WEBHOOK_SECRET',
    required: false,
    minLength: 16,
    description: 'Secret for webhook signature validation.',
  },
  {
    name: 'CORS_ORIGIN',
    required: false,
    description: 'Allowed CORS origin for production.',
  },
];

/**
 * Validate all environment variables
 * Throws error if critical variables are missing
 */
export function validateEnvironment(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const req of ENV_REQUIREMENTS) {
    const value = process.env[req.name];

    // Check if required variable is missing
    if (req.required && !value) {
      errors.push(`CRITICAL: ${req.name} is required. ${req.description}`);
      continue;
    }

    // Set default if not provided
    if (!value && req.defaultValue) {
      process.env[req.name] = req.defaultValue;
      console.log(`ℹ️ ${req.name} not set, using default: ${req.defaultValue}`);
    }

    // Check minimum length
    if (value && req.minLength && value.length < req.minLength) {
      if (req.required) {
        errors.push(
          `CRITICAL: ${req.name} must be at least ${req.minLength} characters. Current: ${value.length} characters.`,
        );
      } else {
        warnings.push(
          `WARNING: ${req.name} should be at least ${req.minLength} characters for security.`,
        );
      }
    }
  }

  // Check if at least one AI provider is configured
  const aiProviders = [
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'GROQ_API_KEY',
    'OPENROUTER_API_KEY',
  ];
  const hasAIProvider = aiProviders.some((key) => process.env[key]);
  if (!hasAIProvider) {
    warnings.push(
      'WARNING: No AI provider API keys configured. AI features will not work.',
    );
  }

  // Report warnings
  for (const warning of warnings) {
    console.warn(`⚠️ ${warning}`);
  }

  // Throw if there are critical errors
  if (errors.length > 0) {
    console.error('\n❌ Environment Validation Failed:\n');
    for (const error of errors) {
      console.error(`   ${error}`);
    }
    console.error(
      '\nPlease configure these variables in your .env file or environment.\n',
    );
    throw new Error(
      'Missing required environment variables. Application cannot start.',
    );
  }

  console.log('✅ Environment validation passed');
}

/**
 * Get environment variable with type safety
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

/**
 * Get required environment variable (throws if missing)
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Check if we're in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if we're in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}
