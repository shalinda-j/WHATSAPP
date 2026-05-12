import Dataset from '../models/Dataset';
import { createCompanyConfig } from '../config/companies';
import { AI_PERSONALITY } from '../config/ai-personality';

const defaultConfig = createCompanyConfig('default');

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

/**
 * Seed sample datasets for the Datasets page tabs
 * These are user-manageable datasets displayed in Admin Panel > Datasets
 */
export const seedSampleDatasets = async () => {
  try {
    console.log('🌱 Seeding Sample Datasets for Datasets Page...');

    const sampleDatasets = [
      // === KNOWLEDGE BASE SAMPLES ===
      {
        name: 'Company Overview',
        type: 'knowledge',
        category: 'company',
        content: {
          en: 'Jayalath Global is a leading recruitment and job placement agency specializing in overseas employment opportunities. We connect skilled workers with reputable employers across multiple countries.',
          si: 'ජයලත් ග්ලෝබල් යනු විදේශ රැකියා අවස්ථා සඳහා විශේෂඥතාවයක් ඇති ප්රමුඛ රැකියා ස්ථාපන ඒජන්සියකි. අපි කුසලතා ඇති කම්කරුවන් බහු රටවල සුදුසු සේවා යෝජකයින් සමඟ සම්බන්ධ කරමු.',
          ta: 'ஜயலத் க்லோபல் என்பது வெளிநாட்டு வேலை வாய்ப்புகளில் சிறப்பு பெற்ற முன்னணி வேலை நியமன நிறுவனம். பல நாடுகளில் தகுதியான வேலையாட்களை நல்ல வேலையாளர்களுடன் இணைக்கிறோம்.',
        },
        scope: 'ALL',
        isActive: true,
        description: 'Basic company introduction for AI responses',
      },
      {
        name: 'Services Overview',
        type: 'knowledge',
        category: 'products',
        content: {
          en: 'We provide: 1) Job placement in Europe, Middle East, and Asia 2) CV screening and preparation 3) Interview coaching 4) Visa and documentation assistance 5) Pre-departure training',
          si: 'අපි ලබා දෙන සේවා: 1) යුරෝපය, මැදපෙරදිග සහ ආසියාවේ රැකියා ස්ථාපනය 2) CV පරීක්ෂණ සහ සූදානම 3) අන්තිම සංවාද පුහුණුව 4) විසා සහ ලේඛන උදව් 5) පිටතට යෑමට පෙර පුහුණුව',
          ta: 'நாம் வழங்கும் சேவைகள்: 1) ஐரோப்பா, மத்திய கிழக்கு, ஆசியாவில் வேலை நியமனம் 2) CV பரிசோதனை மற்றும் தயாரிப்பு 3) நேர்காட்சி பயிற்சி 4) விசா மற்றும் ஆவண உதவி 5) புறப்படுவதற்கு முன் பயிற்சி',
        },
        scope: 'ALL',
        isActive: true,
        description: 'List of services offered',
      },
      {
        name: 'Working Hours',
        type: 'knowledge',
        category: 'general',
        content: {
          en: 'Our office is open Monday to Friday, 9:00 AM to 5:00 PM. We are closed on weekends and public holidays. For urgent inquiries, contact us via WhatsApp.',
          si: 'අපේ කාර්යාලය සඳුදා සිට ඉරිදා දක්වා, පෙ.ව. 9:00 සිට ප.ව. 5:00 දක්වා විවෘත වේ. සති අන්ත සහ රජයේ නිවාඩු දිනවල අපි වසන්නවා. අත්යන්ත්ර විමසීම් සඳහා WhatsApp හරහා අපව අමතන්න.',
          ta: 'எங்கள் அலுவலகம் திங்கள் முதல் வெள்ளி வரை, காலை 9:00 முதல் மாலை 5:00 வரை திறந்திருக்கும். வார இறுதியில் மற்றும் அரசு விடுமுறை நாட்களில் மூடப்பட்டிருக்கும். அவசர விசாரணைகளுக்கு WhatsApp மூலம் தொடர்பு கொள்ளவும்.',
        },
        scope: 'ALL',
        isActive: true,
        description: 'Office working hours information',
      },

      // === COMMANDS SAMPLES ===
      {
        name: 'Help Command',
        type: 'command',
        category: 'basic',
        content: {
          en: 'Shows available commands and help information',
          si: 'ලබා ගත හැකි විධානයන් සහ උදව් තොරතුරු පෙන්වයි',
          ta: 'கிடைக்கும் கட்டளைகள் மற்றும் உதவி தகவல்களை காட்டுகிறது',
        },
        metadata: {
          triggerKeywords: ['!help', 'help', 'උදව්', 'உதவி'],
          aliases: ['!h', '!commands'],
        },
        scope: 'ALL',
        isActive: true,
        description: 'Trigger keyword for help command',
      },
      {
        name: 'Register Command',
        type: 'command',
        category: 'registration',
        content: {
          en: 'Starts the registration process for job applications',
          si: 'රැකියා අයැදුම් සඳහා ලියාපදිංචි කිරීමේ ක්රියාවලිය ආරම්භ කරයි',
          ta: 'வேலை விண்ணப்பங்களுக்கு பதிவு செய்யும் செயல்முறையை தொடங்குகிறது',
        },
        metadata: {
          triggerKeywords: [
            '!register',
            '!join',
            '!apply',
            'ලියාපදිංචි',
            'பதிவு',
          ],
          aliases: ['!reg'],
        },
        scope: 'ALL',
        isActive: true,
        description: 'Trigger keyword for registration',
      },
      {
        name: 'Jobs Command',
        type: 'command',
        category: 'jobs',
        content: {
          en: 'Displays available job vacancies',
          si: 'ලබා ගත හැකි රැකියා හිස් තනතුරු පෙන්වයි',
          ta: 'கிடைக்கும் வேலை வாய்ப்புகளை காட்டுகிறது',
        },
        metadata: {
          triggerKeywords: ['!jobs', 'jobs', 'රැකියා', 'வேலை'],
          aliases: ['!vacancies', '!positions'],
        },
        scope: 'ALL',
        isActive: true,
        description: 'Trigger keyword for jobs listing',
      },

      // === LINKS SAMPLES ===
      {
        name: 'Registration Form',
        type: 'link',
        category: 'forms',
        content: {
          en: 'Online registration form for job applicants',
          si: 'රැකියා අයැදුම්කරුවන් සඳහා මාර්ගගත ලියාපදිංචි පෝරමය',
          ta: 'வேலை விண்ணப்பதாரர்களுக்கு ஆன்லைன் பதிவு படிவம்',
        },
        metadata: {
          url: 'https://forms.google.com/registration',
          formId: 'registration_form',
        },
        scope: 'ALL',
        isActive: true,
        description: 'Link to registration form',
      },
      {
        name: 'Company Website',
        type: 'link',
        category: 'website',
        content: {
          en: 'Official company website with detailed information',
          si: 'සවිස්තර තොරතුරු සහිත නිල සමාගම් වෙබ් අඩවිය',
          ta: 'விரிவான தகவல்களைக் கொண்ட அதிகாரப்பூர்வ நிறுவன இணையதளம்',
        },
        metadata: {
          url: 'https://jayalathglobal.com',
        },
        scope: 'ALL',
        isActive: true,
        description: 'Link to company website',
      },

      // === MEGA TEXT SAMPLES ===
      {
        name: 'Job Application Guide',
        type: 'megatext',
        category: 'guides',
        content: {
          en: `**Job Application Process**

Step 1: Send your CV
- Use !cv command to get submission instructions
- Include your full name, contact details, and work experience

Step 2: Initial Screening
- Our team reviews your CV within 2-3 days
- Qualified candidates receive interview invitation

Step 3: Interview Preparation
- Attend coaching sessions if needed
- Prepare documents: passport, certificates, photos

Step 4: Final Selection
- Successful candidates receive job offer
- Visa processing begins

Step 5: Pre-departure
- Complete required training
- Final documentation check`,
          si: `**රැකියා අයැදුම් ක්රියාවලිය**

පියවර 1: ඔබේ CV යවන්න
- !cv විධානය භාවිතා කර ඉදිරිපත් කිරීමේ උපදෙස් ලබන්න
- ඔබේ සම්පූර්ණ නම, සම්බන්ධතා විස්තර සහ වැඩ අත්දැකීම් ඇතුළත් කරන්න

පියවර 2: මූලික පරීක්ෂණය
- අපේ කණ්ඩායම ඔබේ CV 2-3 දින ඇතුළත පරීක්ෂණ කරයි
- සුදුසු අයැදුම්කරුවන්ට අන්තිම සංවාද ආරාධනා ලැබේ

පියවර 3: අන්තිම සංවාද සූදානම
- අවශ්ය නම් පුහුණු සැසිවලට සහභාගී වන්න
- ලේඛන සූදානම: ගමන් බලපතර, සහතිකයන්, ඡායාරූප

පියවර 4: අවසාන තේරීම
- සාර්ථක අයැදුම්කරුවන්ට රැකියා ප්රස්තාව ලැබේ
- විසා සැකසීම ආරම්භ වේ

පියවර 5: පිටතට යෑමට පෙර
- අවශ්ය පුහුණුව සම්පූර්ණ කරන්න
- අවසාන ලේඛන පරීක්ෂණ`,
          ta: `**வேலை விண்ணப்ப செயல்முறை**

படி 1: உங்கள் CV ஐ அனுப்பவும்
- !cv கட்டளையை பயன்படுத்தி சமர்ப்பிப்பு விவரங்களை பெறவும்
- உங்கள் முழு பெயர், தொடர்பு விவரங்கள், வேலை அனுபவம் சேர்க்கவும்

படி 2: ஆரம்ப பரிசோதனை
- எங்கள் குழு 2-3 நாட்களில் உங்கள் CV ஐ பரிசோதிக்கும்
- தகுதியான விண்ணப்பதாரர்கள் நேர்காட்சி அழைப்பு பெறுவார்கள்

படி 3: நேர்காட்சி தயாரிப்பு
- தேவைப்பட்டால் பயிற்சி செய்யவும்
- ஆவணங்கள் தயார்: பாஸ்போர்ட், சான்றிதழ்கள், புகைப்படங்கள்

படி 4: இறுதி தேர்வு
- வெற்றிகரமான விண்ணப்பதாரர்கள் வேலை வாய்ப்பு பெறுவார்கள்
- விசா செயல்முறை தொடங்கும்

படி 5: புறப்படுவதற்கு முன்
- தேவையான பயிற்சியை முடிக்கவும்
- இறுதி ஆவண பரிசோதனை`,
        },
        scope: 'ALL',
        isActive: true,
        description: 'Complete job application process guide',
        metadata: {
          documentType: 'knowledge',
        },
      },

      // === AI PERSONALITY SAMPLES ===
      {
        name: 'Default AI Personality',
        type: 'personality',
        category: 'default',
        content: {
          en: `You are a helpful, professional AI assistant for Jayalath Global Recruitment Agency.

Your role:
- Help users find job opportunities
- Answer questions about services, countries, and job types
- Guide users through registration process
- Provide information in a friendly, professional manner

Communication style:
- Be polite and professional
- Keep responses concise (max 2-3 sentences unless detailed explanation needed)
- Use appropriate greetings based on language
- Match user's language (Sinhala, Tamil, or English)

Key principles:
- Never make promises about job placement
- Always encourage users to register formally
- Direct users to appropriate commands (!help, !jobs, !register)
- Be honest about process timelines`,
          si: `ඔබ ජයලත් ග්ලෝබල් රැකියා ස්ථාපන ඒජන්සිය සඳහා උදව් දෙන, වෘත්තීය AI සහයකයෙක්.

ඔබේ කර්තව්යය:
- පරිශීලකයින්ට රැකියා අවස්ථා සොයා ගන්න උදව් කරන්න
- සේවා, රටවල් සහ රැකියා වර්ග ගැන ප්රශ්නවලට පිළිතුරු දෙන්න
- ලියාපදිංචි ක්රියාවලිය හරහා පරිශීලකයින් මෙය කරන්න
- මිත්රශීලී, වෘත්තීය ආකාරයෙන් තොරතුරු ලබා දෙන්න

සන්නිවේදන ශෛලිය:
- හිතවත් සහ වෘත්තීය වන්න
- පිළිතුරු කෙටිව තබන්න (උපරිම 2-3 වාක්ය)
- භාෂාව අනුව සුදුසු සාදර ගැනීම් භාවිතා කරන්න
- පරිශීලකයාගේ භාෂාවට ගැලපෙන්න (සිංහල, දෙමළ, හෝ ඉංග්රීසි)`,
          ta: `நீங்கள் ஜயலத் க்லோபல் வேலை நியமன நிறுவனத்திற்கு உதவியான, தொழில்முறை AI உதவியாளர்.

உங்கள் பங்கு:
- பயனர்களை வேலை வாய்ப்புகள் கண்டுபிடிக்க உதவுங்கள்
- சேவைகள், நாடுகள், வேலை வகைகள் பற்றி கேள்விகளுக்கு பதில் அளியுங்கள்
- பதிவு செயல்முறையில் பயனர்களை வழிநடத்துங்கள்
- நட்புறவு, தொழில்முறை முறையில் தகவல் வழங்குங்கள்

தகவல் தொடர்பு நடை:
- பணிப்புடன் தொழில்முறையாக இருங்கள்
- பதில்கள் சுருக்கமாக (அதிகபட்சம் 2-3 வாக்கியங்கள்)
- மொழி அடிப்படையில் பொருத்தமான வாழ்த்துகள் பயன்படுத்துங்கள்
- பயனர் மொழிக்கு பொருந்துங்கள் (சிங்களம், தமிழ், ஆங்கிலம்)`,
        },
        scope: 'ALL',
        isActive: true,
        description: 'Default AI personality settings',
      },
    ];

    for (const dataset of sampleDatasets) {
      // Check if dataset with same name exists
      const existing = await Dataset.findOne({
        name: dataset.name,
        type: dataset.type,
      });
      if (!existing) {
        await Dataset.create(dataset);
        console.log(
          `   ✅ Seeded Sample Dataset: ${dataset.name} (${dataset.type})`,
        );
      }
    }

    console.log('🌱 Sample datasets seeding complete.');
  } catch (error) {
    console.error('❌ Error seeding sample datasets:', error);
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
        content: '', // Empty - must be configured
        description:
          'System prompt and personality settings - MUST CONFIGURE IN ADMIN PANEL',
      },
      {
        key: 'AI_KNOWLEDGE_BASE',
        name: 'AI Knowledge Base',
        type: 'config', // Configuration item, not displayed in Datasets tabs
        category: 'ai',
        content: '', // Empty - must be configured
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

    // First, migrate existing config items to have correct type
    await migrateConfigDatasets();

    for (const seed of seeds) {
      const existing = await Dataset.findOne({ key: seed.key });
      if (!existing) {
        await Dataset.create(seed);
        console.log(`   ✅ Seeded Dataset: ${seed.name}`);
      }
    }

    // Seed sample datasets for Datasets page
    await seedSampleDatasets();

    console.log('🌱 Dataset seeding complete.');
    console.log('   ⚠️ IMPORTANT: Config datasets are EMPTY by default!');
    console.log('   ⚠️ You MUST configure via Admin Panel > Settings');
  } catch (error) {
    console.error('❌ Error Seeding Datasets:', error);
  }
};
