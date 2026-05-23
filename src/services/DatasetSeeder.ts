import Dataset from '../models/Dataset';
import { EMPTY_LEAD_FALLBACK_TEMPLATES } from './ConfigService';

// NOTE: this seeder intentionally creates ONLY empty config placeholders
// (keyed rows whose `content` is an empty string / object / array). It
// does NOT ship company-specific knowledge, command, link or personality
// content — that's tenant data and lives in MongoDB, edited via the
// admin Datasets page. A previous version of this file hard-coded
// "Jayalath Global" knowledge entries, demo commands and demo URLs,
// which would resurrect themselves on every restart even if the
// operator had deleted them. Removed in this fix.

/**
 * Migration: clear `key: ''` left behind by the old POST/PUT logic.
 *
 * The Dataset schema has `key: { unique: true, sparse: true }`. A sparse
 * unique index skips docs where the field is null/missing, but `''` is a
 * value — so every row written by the old route with `key: ''` shared
 * the same unique-index slot, and the second such insert was rejected
 * with E11000. That made user-created knowledge entries appear to save
 * once and then fail silently from the second onward.
 *
 * This migration is idempotent and only touches rows with `key === ''`.
 */
export const cleanEmptyDatasetKeys = async () => {
  try {
    const result = await Dataset.updateMany(
      { key: '' },
      { $unset: { key: '' } },
    );
    if (result.modifiedCount > 0) {
      console.log(
        `🩹 Cleaned ${result.modifiedCount} Dataset row(s) with empty key:'' (so the sparse unique index ignores them).`,
      );
    }
  } catch (error) {
    console.error('❌ Error cleaning empty Dataset keys:', error);
  }
};

/**
 * Migration: Update existing config items to have type='config'
 * This fixes old documents that were seeded without explicit type
 */
export const migrateConfigDatasets = async () => {
  try {
    console.log('🔄 Migrating Config Datasets...');

    // List of keys that should be 'config' type (not displayed in Datasets page)
    const configKeys = [
      'HELP_MESSAGE',
      'JOBS_MESSAGE',
      'CLEAR_MESSAGE',
      'STOP_MESSAGE',
      'START_MESSAGE',
      'PING_MESSAGE',
      'WELCOME_MESSAGE',
      'UNKNOWN_COMMAND_MESSAGE',
      'REGISTRATION_CONFIG',
      'PAYMENT_CONFIG',
      'CV_CONFIG',
      'BANK_ACCOUNTS',
      'AI_PERSONALITY',
      'AI_KNOWLEDGE_BASE',
      'COMPANY_INFO',
      'JOB_TYPES',
      'BOOKING_KEYWORDS',
      'BOOKING_CONFIG',
      'HUMANIZER_CONFIG',
      'CONVERSATION_EXAMPLES',
      'COUNTRIES',
      'EXPERIENCE_LEVELS',
      'LEAD_FALLBACK_TEMPLATES',
    ];

    // Update all documents with these keys to have type='config'
    for (const key of configKeys) {
      const result = await Dataset.updateOne(
        { key },
        { $set: { type: 'config' } },
      );
      if (result.modifiedCount > 0) {
        console.log(`   ✅ Migrated: ${key} → type='config'`);
      }
    }

    console.log('🔄 Config migration complete.');
  } catch (error) {
    console.error('❌ Error migrating config datasets:', error);
  }
};


export const seedDatasets = async () => {
  try {
    console.log('🌱 Checking Dataset Seeds...');

    // All datasets are seeded with EMPTY defaults
    // Configure values via Admin Panel > Datasets

    const seeds = [
      // === MESSAGE TEMPLATES (No Hardcoded Messages) ===
      {
        key: 'HELP_MESSAGE',
        name: 'Help Message Template',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        content: {
          title: '',
          subtitle: '',
          commands: [],
          footer: '',
        },
        description: 'Help message template - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'JOBS_MESSAGE',
        name: 'Jobs Message Template',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        content: {
          title: '',
          jobs: [],
          footer: '',
        },
        description: 'Jobs listing message - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'CLEAR_MESSAGE',
        name: 'Clear Conversation Message',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        content: {
          message: '',
        },
        description:
          'Message shown when conversation is cleared - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'STOP_MESSAGE',
        name: 'Stop Auto-Registration Message',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        content: {
          message: '',
        },
        description:
          'Message shown when user opts out of auto-registration - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'START_MESSAGE',
        name: 'Start Auto-Registration Message',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        content: {
          message: '',
        },
        description:
          'Message shown when user opts back in to auto-registration - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'LEAD_FALLBACK_TEMPLATES',
        name: 'Lead Intake Fallback Templates',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        // Empty defaults — operator MUST configure each slot via admin panel.
        // When AI providers are down, the bot picks the matching slot based
        // on which lead facts have been collected so far. Supports
        // {name}, {country}, {phone} placeholders.
        content: EMPTY_LEAD_FALLBACK_TEMPLATES,
        description:
          'Lead-intake reply templates used when AI is unavailable. 7 slots: haveAll, havePhoneCountry, havePhone, haveCountry, haveName, greeting, empty. Each supports {name}, {country}, {phone} placeholders - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'PING_MESSAGE',
        name: 'Ping Message',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        content: {
          message: '',
        },
        description:
          'Message shown for !ping command - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'WELCOME_MESSAGE',
        name: 'Welcome Message',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        content: {
          message: '',
        },
        description: 'Welcome message for new users - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'UNKNOWN_COMMAND_MESSAGE',
        name: 'Unknown Command Message',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'messages',
        content: {
          message: '',
        },
        description:
          'Message template for unknown commands. Use {command} placeholder - CONFIGURE IN ADMIN PANEL',
      },

      // === CONFIGURATION ===
      {
        key: 'REGISTRATION_CONFIG',
        name: 'Registration Links',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: {}, // Empty - must be configured
        description:
          'Links and messages for registration - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'PAYMENT_CONFIG',
        name: 'Payment Instructions',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: {}, // Empty - must be configured
        description:
          'Payment instructions and messages - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'CV_CONFIG',
        name: 'CV Submission',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: {}, // Empty - must be configured
        description:
          'Settings for CV upload workflow - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'BANK_ACCOUNTS',
        name: 'Bank Accounts',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'finance',
        content: [], // Empty - must be configured
        description: 'Bank account details - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'AI_PERSONALITY',
        name: 'AI Personality',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'ai',
        // Multi-language object shape — matches what AIPersonalityTab in the
        // admin panel writes. Using a flat string here caused the previous
        // bug where syncWithAI() flattened the shape and the admin panel
        // then couldn't read content.en, reverting to its frontend default.
        content: { en: '', si: '', ta: '' },
        description:
          'System prompt and personality settings - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'AI_KNOWLEDGE_BASE',
        name: 'AI Knowledge Base',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'ai',
        content: { en: '', si: '', ta: '' },
        description:
          'Knowledge base content for AI - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'COMPANY_INFO',
        name: 'Company Information',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'info',
        content: {
          name: '',
          contact: '',
          address: '',
          email: '',
        },
        description: 'Company contact details - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'JOB_TYPES',
        name: 'Job Vacancy Types',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: [], // Empty - must be configured
        description:
          'Available job types for registration - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'BOOKING_KEYWORDS',
        name: 'Booking Keywords',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: [], // Empty - must be configured
        description:
          'Keywords that trigger booking intent - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'BOOKING_CONFIG',
        name: 'Booking Configuration',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: {
          campusLocation: '',
          organizerName: '',
          organizerEmail: '',
          eventTitle: '',
          eventDescription: '',
          workHoursStart: 8,
          workHoursEnd: 17,
          eventDurationHours: 1,
          acceptanceKeywords: [],
        },
        description:
          'Booking system configuration - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'HUMANIZER_CONFIG',
        name: 'Humanizer Configuration',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: {
          enabled: true,
          maxQueueSize: 100,
          maxRetries: 3,
          retryDelayMs: 5000,
          reactionDelayMin: 1000,
          reactionDelayMax: 2500,
          typingSpeedCharsPerMin: 250,
          minTypingDelayMs: 1500,
          maxTypingDelayMs: 8000,
        },
        description:
          'Timing parameters for message humanization - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'CONVERSATION_EXAMPLES',
        name: 'Conversation Examples',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'ai',
        content: [], // Empty - must be configured
        description:
          'Training examples for AI conversation context - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'COUNTRIES',
        name: 'Job Placement Countries',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: [], // Empty - must be configured
        description:
          'Countries available for job placement - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'EXPERIENCE_LEVELS',
        name: 'Experience Levels',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'config',
        content: [], // Empty - must be configured
        description:
          'Experience level options for registration - MUST CONFIGURE IN ADMIN PANEL',
      },
    ];

    // First, migrate existing config items to have correct type.
    await migrateConfigDatasets();
    // Then clean any `key: ''` rows left over from the old POST/PUT bug
    // so the sparse unique index stops blocking new inserts.
    await cleanEmptyDatasetKeys();

    for (const seed of seeds) {
      const existing = await Dataset.findOne({ key: seed.key });
      if (!existing) {
        await Dataset.create(seed);
        console.log(`   ✅ Seeded Dataset: ${seed.name}`);
      }
    }

    // Sample-dataset seed removed (was hard-coded "Jayalath Global"
    // knowledge / command / link content). Tenant-specific content
    // must be authored through the Datasets admin page, not baked
    // into the seeder.

    console.log('🌱 Dataset seeding complete.');
    console.log('   ⚠️ IMPORTANT: Config datasets are EMPTY by default!');
    console.log('   ⚠️ You MUST configure via Admin Panel > Settings');
  } catch (error) {
    console.error('❌ Error Seeding Datasets:', error);
  }
};