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
      {
        key: 'REGISTRATION_CONFIG',
        name: 'Registration Links',
        category: 'config',
        content: defaultConfig.links.registration,
        description: 'Links and messages for course registration - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'PAYMENT_CONFIG',
        name: 'Payment Instructions',
        category: 'config',
        content: defaultConfig.links.payment,
        description: 'General payment instructions and messages - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'CV_CONFIG',
        name: 'CV Submission',
        category: 'config',
        content: defaultConfig.links.cv,
        description: 'Settings for CV upload workflow - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'BANK_ACCOUNTS',
        name: 'Bank Accounts',
        category: 'finance',
        content: defaultConfig.links.payment.categories,
        description: 'Bank account details by category - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'AI_PERSONALITY',
        name: 'AI Personality',
        category: 'ai',
        content: AI_PERSONALITY(defaultConfig),
        description: 'System prompt and personality settings - CONFIGURE IN ADMIN PANEL',
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
        content: [],  // Empty - must be configured via admin panel
        description: 'Available job types for lead registration - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'BOOKING_KEYWORDS',
        name: 'Booking Keywords',
        category: 'config',
        content: [],  // Empty - must be configured via admin panel
        description: 'Keywords that trigger booking intent detection (English, Sinhala, etc.) - MUST CONFIGURE IN ADMIN PANEL',
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
        content: [],  // Empty - must be configured via admin panel
        description: 'Training examples for AI conversation context - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'COUNTRIES',
        name: 'Job Placement Countries',
        category: 'config',
        content: [
          { code: 'IL', name: 'Israel', flag: '🇮🇱' },
          { code: 'AE', name: 'UAE (Dubai)', flag: '🇦🇪' },
          { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
          { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
          { code: 'KW', name: 'Kuwait', flag: '🇰🇼' },
          { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
          { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
          { code: 'LK', name: 'Sri Lanka', flag: '🇱🇰' },
          { code: 'OTHER', name: 'Other', flag: '🌍' },
        ],
        description: 'Countries available for job placement - CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'EXPERIENCE_LEVELS',
        name: 'Experience Levels',
        category: 'config',
        content: [
          { value: '0-1', label: '0-1 years (Fresher)' },
          { value: '1-3', label: '1-3 years' },
          { value: '3-5', label: '3-5 years' },
          { value: '5-10', label: '5-10 years' },
          { value: '10+', label: '10+ years (Expert)' },
        ],
        description: 'Experience level options for lead registration - CONFIGURE IN ADMIN PANEL',
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
    console.log('   ⚠️ IMPORTANT: Configure all datasets via Admin Panel > Datasets');
  } catch (error) {
    console.error('❌ Error Seeding Datasets:', error);
  }
};