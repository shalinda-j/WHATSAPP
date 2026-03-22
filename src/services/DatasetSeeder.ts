import Dataset from '../models/Dataset';
import { createCompanyConfig } from '../config/companies';
import { AI_PERSONALITY } from '../config/ai-personality';

const defaultConfig = createCompanyConfig('default');

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
        category: 'messages',
        content: {
          message: '',
        },
        description: 'Message shown when conversation is cleared - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'STOP_MESSAGE',
        name: 'Stop Auto-Registration Message',
        category: 'messages',
        content: {
          message: '',
        },
        description: 'Message shown when user opts out of auto-registration - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'START_MESSAGE',
        name: 'Start Auto-Registration Message',
        category: 'messages',
        content: {
          message: '',
        },
        description: 'Message shown when user opts back in to auto-registration - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'PING_MESSAGE',
        name: 'Ping Message',
        category: 'messages',
        content: {
          message: '',
        },
        description: 'Message shown for !ping command - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'WELCOME_MESSAGE',
        name: 'Welcome Message',
        category: 'messages',
        content: {
          message: '',
        },
        description: 'Welcome message for new users - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'UNKNOWN_COMMAND_MESSAGE',
        name: 'Unknown Command Message',
        category: 'messages',
        content: {
          message: '',
        },
        description: 'Message template for unknown commands. Use {command} placeholder - CONFIGURE IN ADMIN PANEL',
      },

      // === CONFIGURATION ===
      {
        key: 'REGISTRATION_CONFIG',
        name: 'Registration Links',
        category: 'config',
        content: {},  // Empty - must be configured
        description: 'Links and messages for registration - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'PAYMENT_CONFIG',
        name: 'Payment Instructions',
        category: 'config',
        content: {},  // Empty - must be configured
        description: 'Payment instructions and messages - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'CV_CONFIG',
        name: 'CV Submission',
        category: 'config',
        content: {},  // Empty - must be configured
        description: 'Settings for CV upload workflow - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'BANK_ACCOUNTS',
        name: 'Bank Accounts',
        category: 'finance',
        content: [],  // Empty - must be configured
        description: 'Bank account details - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'AI_PERSONALITY',
        name: 'AI Personality',
        category: 'ai',
        content: '',  // Empty - must be configured
        description: 'System prompt and personality settings - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'AI_KNOWLEDGE_BASE',
        name: 'AI Knowledge Base',
        category: 'ai',
        content: '',  // Empty - must be configured
        description: 'Knowledge base content for AI - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'COMPANY_INFO',
        name: 'Company Information',
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
        category: 'config',
        content: [],  // Empty - must be configured
        description: 'Available job types for registration - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'BOOKING_KEYWORDS',
        name: 'Booking Keywords',
        category: 'config',
        content: [],  // Empty - must be configured
        description: 'Keywords that trigger booking intent - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'BOOKING_CONFIG',
        name: 'Booking Configuration',
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
        description: 'Booking system configuration - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'HUMANIZER_CONFIG',
        name: 'Humanizer Configuration',
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
        description: 'Timing parameters for message humanization - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'CONVERSATION_EXAMPLES',
        name: 'Conversation Examples',
        category: 'ai',
        content: [],  // Empty - must be configured
        description: 'Training examples for AI conversation context - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'COUNTRIES',
        name: 'Job Placement Countries',
        category: 'config',
        content: [],  // Empty - must be configured
        description: 'Countries available for job placement - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'EXPERIENCE_LEVELS',
        name: 'Experience Levels',
        category: 'config',
        content: [],  // Empty - must be configured
        description: 'Experience level options for registration - MUST CONFIGURE IN ADMIN PANEL',
      },
    ];

    for (const seed of seeds) {
      const existing = await Dataset.findOne({ key: seed.key });
      if (!existing) {
        await Dataset.create(seed);
        console.log(`   ✅ Seeded Dataset: ${seed.name}`);
      }
    }

    console.log('🌱 Dataset seeding complete.');
    console.log('   ⚠️ IMPORTANT: ALL datasets are EMPTY by default!');
    console.log('   ⚠️ You MUST configure all datasets via Admin Panel > Datasets');
  } catch (error) {
    console.error('❌ Error Seeding Datasets:', error);
  }
};