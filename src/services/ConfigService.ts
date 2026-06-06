import Dataset from '../models/Dataset';
import {
  getRegistrationMessage,
  getPaymentMessage,
  getCVMessage,
} from '../config/links-config';
import { AI_PERSONALITY, JOB_KNOWLEDGE_BASE } from '../config/ai-personality';
import { createCompanyConfig } from '../config/companies';

const defaultConfig = createCompanyConfig('default');

// Types for configurable settings
export interface HumanizerConfig {
  enabled: boolean;
  maxQueueSize: number;
  maxRetries: number;
  retryDelayMs: number;
  reactionDelayMin: number;
  reactionDelayMax: number;
  typingSpeedCharsPerMin: number;
  minTypingDelayMs: number;
  maxTypingDelayMs: number;
}

export interface ConversationExample {
  user: string;
  assistant: string;
}

// Booking Configuration Interface
export interface BookingConfig {
  campusLocation: string;
  organizerName: string;
  organizerEmail: string;
  eventTitle: string;
  eventDescription: string;
  workHoursStart: number;
  workHoursEnd: number;
  eventDurationHours: number;
  acceptanceKeywords: string[];
}

// Company Info Interface
export interface CompanyInfo {
  name: string;
  contact: string;
  address: string;
  email?: string;
}

/**
 * Lead-intake fallback templates — used when the AI providers are down or
 * not configured. Each value supports {name}, {country}, {phone} placeholders.
 * Configure via Admin Panel > Datasets > LEAD_FALLBACK_TEMPLATES.
 *
 * NO hardcoded defaults — operators MUST configure each slot via the admin
 * panel. If a slot is empty when the fallback runs, the bot logs and skips
 * the reply rather than echoing made-up text at the customer.
 */
export interface LeadFallbackTemplates {
  haveAll: string;
  havePhoneCountry: string;
  havePhone: string;
  haveCountry: string;
  haveName: string;
  greeting: string;
  empty: string;
}

export const EMPTY_LEAD_FALLBACK_TEMPLATES: LeadFallbackTemplates = {
  haveAll: '',
  havePhoneCountry: '',
  havePhone: '',
  haveCountry: '',
  haveName: '',
  greeting: '',
  empty: '',
};

// Country for Job Placement
export interface CountryOption {
  code: string;
  name: string;
  flag: string;
}

// Experience Level
export interface ExperienceOption {
  value: string;
  label: string;
}

// ============================================
// NO DEFAULT CONTENT VALUES - Configure via Admin Panel
// All content values must be set through Datasets section
// Technical defaults (like timeouts) are acceptable
// ============================================

const DEFAULT_HUMANIZER_CONFIG: HumanizerConfig = {
  enabled: true,
  maxQueueSize: 100,
  maxRetries: 3,
  retryDelayMs: 5000,
  reactionDelayMin: 1000,
  reactionDelayMax: 2500,
  typingSpeedCharsPerMin: 250,
  minTypingDelayMs: 1500,
  maxTypingDelayMs: 8000,
};

const DEFAULT_CONVERSATION_EXAMPLES: ConversationExample[] = [];

const DEFAULT_JOB_TYPES: string[] = [];

const DEFAULT_BOOKING_KEYWORDS: string[] = [];

const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  campusLocation: '',
  organizerName: '',
  organizerEmail: '',
  eventTitle: '',
  eventDescription: '',
  workHoursStart: 8,
  workHoursEnd: 17,
  eventDurationHours: 1,
  acceptanceKeywords: [],
};

const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: '',
  contact: '',
  address: '',
  email: '',
};

// NO DEFAULT COUNTRIES - Must be configured via Admin Panel
const DEFAULT_COUNTRIES: CountryOption[] = [];

// NO DEFAULT EXPERIENCE LEVELS - Must be configured via Admin Panel
const DEFAULT_EXPERIENCE_LEVELS: ExperienceOption[] = [];

export class ConfigService {
  private static instance: ConfigService;
  // Simple in-memory cache to avoid DB hits on every message
  private cache: Record<string, any> = {};
  private cacheTTL = 60 * 1000; // 1 minute
  private lastFetch: Record<string, number> = {};

  private constructor() {
    // Singleton pattern - instance created via Instance property
  }

  public static get Instance(): ConfigService {
    if (!this.instance) {
      this.instance = new ConfigService();
    }
    return this.instance;
  }

  public getCompanyConfig(companyId: string) {
    return createCompanyConfig(companyId);
  }

  /**
   * Generic fetcher with cache
   */
  private async get(key: string, fallback: any): Promise<any> {
    const now = Date.now();
    if (this.cache[key] && now - (this.lastFetch[key] || 0) < this.cacheTTL) {
      return this.cache[key];
    }

    try {
      const dataset = await Dataset.findOne({ key, isActive: true });
      if (dataset) {
        // Handle both formats: legacy (content is the raw value) and new
        // (content is a multi-language map { en, si, ta }).
        let content = dataset.content;
        const ml = content as Record<string, any> | null;
        const isMultiLang =
          ml &&
          typeof ml === 'object' &&
          !Array.isArray(ml) &&
          (typeof ml.en === 'string' ||
            typeof ml.si === 'string' ||
            typeof ml.ta === 'string');
        if (isMultiLang) {
          // Pick the first NON-EMPTY language (English preferred, then Sinhala,
          // then Tamil). Previously we only read `content.en`; when the operator
          // typed a prompt in Sinhala/Tamil and left English blank, this method
          // returned the raw { en, si, ta } object, which stringifies to
          // "[object Object]" inside the AI system prompt and silently broke the
          // configured personality. If every language is empty we treat the row
          // as unset and fall through to the caller's default below.
          const picked = [ml.en, ml.si, ml.ta].find(
            (v) => typeof v === 'string' && v.trim().length > 0,
          );
          if (picked === undefined) {
            this.cache[key] = fallback;
            this.lastFetch[key] = now;
            return fallback;
          }
          content = picked;
        }
        this.cache[key] = content;
        this.lastFetch[key] = now;
        return content;
      }
    } catch (error) {
      console.error(`Error fetching config ${key}:`, error);
    }

    // cache fallback too to prevent repeated DB failures
    this.cache[key] = fallback;
    this.lastFetch[key] = now;
    return fallback;
  }

  public async getRegistrationConfig() {
    return this.get('REGISTRATION_CONFIG', defaultConfig.links.registration);
  }

  public async getPaymentConfig() {
    return this.get('PAYMENT_CONFIG', defaultConfig.links.payment);
  }

  public async getCVConfig() {
    return this.get('CV_CONFIG', defaultConfig.links.cv);
  }

  public async getBankAccounts() {
    return this.get(
      'BANK_ACCOUNTS',
      defaultConfig.links.payment.categories || {},
    );
  }

  public async getAIPersonality() {
    return this.get('AI_PERSONALITY', AI_PERSONALITY(defaultConfig));
  }

  /**
   * Get Google API Key from Config
   */
  public async getGoogleProviderKey(): Promise<string | undefined> {
    try {
      const ConfigModel = (await import('../models/Config')).default;
      const config = await ConfigModel.findOne({
        isProvider: true,
        providerType: 'google',
        isActive: true,
      });
      return config?.apiKey;
    } catch (error) {
      console.error('Error fetching Google Provider Key:', error);
      return undefined;
    }
  }

  /**
   * Get Humanizer configuration with timing parameters
   * Configure via Admin Panel > Datasets > HUMANIZER_CONFIG
   */
  public async getHumanizerConfig(): Promise<HumanizerConfig> {
    const config = await this.get('HUMANIZER_CONFIG', DEFAULT_HUMANIZER_CONFIG);
    // Merge with defaults to ensure all fields are present
    return { ...DEFAULT_HUMANIZER_CONFIG, ...config };
  }

  /**
   * Get Conversation Examples for AI training
   * Configure via Admin Panel > Datasets > CONVERSATION_EXAMPLES
   */
  public async getConversationExamples(): Promise<ConversationExample[]> {
    const examples = await this.get(
      'CONVERSATION_EXAMPLES',
      DEFAULT_CONVERSATION_EXAMPLES,
    );
    // Validate it's an array
    if (Array.isArray(examples) && examples.length > 0) {
      return examples;
    }
    return DEFAULT_CONVERSATION_EXAMPLES;
  }

  /**
   * Get Job Types for Lead Registration
   * Configure via Admin Panel > Datasets > JOB_TYPES
   */
  public async getJobTypes(): Promise<string[]> {
    const jobTypes = await this.get('JOB_TYPES', DEFAULT_JOB_TYPES);
    // Validate it's an array with content
    if (Array.isArray(jobTypes) && jobTypes.length > 0) {
      return jobTypes;
    }
    console.warn(
      '⚠️ JOB_TYPES not configured. Please set up in Admin Panel > Datasets.',
    );
    return DEFAULT_JOB_TYPES;
  }

  /**
   * Get Booking Keywords for intent detection
   * Configure via Admin Panel > Datasets > BOOKING_KEYWORDS
   */
  public async getBookingKeywords(): Promise<string[]> {
    const keywords = await this.get(
      'BOOKING_KEYWORDS',
      DEFAULT_BOOKING_KEYWORDS,
    );
    // Validate it's an array with content
    if (Array.isArray(keywords) && keywords.length > 0) {
      return keywords;
    }
    console.warn(
      '⚠️ BOOKING_KEYWORDS not configured. Please set up in Admin Panel > Datasets.',
    );
    return DEFAULT_BOOKING_KEYWORDS;
  }

  /**
   * Get Booking Configuration (location, organizer, etc.)
   * Configure via Admin Panel > Datasets > BOOKING_CONFIG
   */
  public async getBookingConfig(): Promise<BookingConfig> {
    const config = await this.get('BOOKING_CONFIG', DEFAULT_BOOKING_CONFIG);
    // Merge with defaults to ensure all fields are present
    const merged = { ...DEFAULT_BOOKING_CONFIG, ...config };

    // Warn if critical fields are empty
    if (!merged.campusLocation || !merged.organizerName) {
      console.warn(
        '⚠️ BOOKING_CONFIG not fully configured. Please set up in Admin Panel > Datasets.',
      );
    }

    return merged;
  }

  /**
   * Get Company Information
   * Configure via Admin Panel > Datasets > COMPANY_INFO
   */
  public async getCompanyInfo(): Promise<CompanyInfo> {
    const info = await this.get('COMPANY_INFO', DEFAULT_COMPANY_INFO);
    // Merge with defaults to ensure all fields are present
    const merged = { ...DEFAULT_COMPANY_INFO, ...info };

    // Warn if critical fields are empty
    if (!merged.name || !merged.contact) {
      console.warn(
        '⚠️ COMPANY_INFO not fully configured. Please set up in Admin Panel > Datasets.',
      );
    }

    return merged;
  }

  public async getRegistrationMessage(): Promise<string> {
    const config = await this.getRegistrationConfig();
    return config.message || getRegistrationMessage(defaultConfig);
  }

  public async getCVMessage(): Promise<string> {
    const config = await this.getCVConfig();
    return (
      config.message?.replace('{{FORM_URL}}', config.formUrl) ||
      getCVMessage(defaultConfig)
    );
  }

  public async getPaymentMessage(query?: string): Promise<string> {
    // For now, we utilize the default logic for message generation since
    // completely dynamic logic is complex to port into this service directly
    // without refactoring everything to use CompanyConfig.
    return getPaymentMessage(defaultConfig, query);
  }

  public async getDynamicKnowledgeBase(): Promise<string> {
    const cacheKey = 'DYNAMIC_KB';
    const now = Date.now();

    // Check cache
    if (
      this.cache[cacheKey] &&
      now - (this.lastFetch[cacheKey] || 0) < this.cacheTTL
    ) {
      return this.cache[cacheKey];
    }

    try {
      // Fetch only KNOWLEDGE-bearing datasets for the AI context. Previously
      // this read EVERY active dataset (commands, links, personality, config,
      // acknowledgements, etc.), dumping their raw JSON into the prompt — that
      // bloated the token budget and fed the model internal config that looked
      // like Q&A. We now include only the types meant to inform answers, which
      // also means megatext documents finally reach the AI.
      const datasets = await Dataset.find({
        isActive: true,
        $or: [
          { type: { $in: ['knowledge', 'megatext'] } },
          { type: { $exists: false } }, // legacy rows with no type
          { type: null },
        ],
      });

      let dynamicContent = '';
      if (datasets.length > 0) {
        dynamicContent = '\n\n# 📂 Dynamic Datasets (From Admin Panel)\n';
        datasets.forEach((ds: any) => {
          // Handle both string and object content
          const content =
            typeof ds.content === 'string'
              ? ds.content
              : JSON.stringify(ds.content, null, 2);
          dynamicContent += `\n## ${ds.name} (${
            ds.scope || ds.category
          })\n${content}\n---\n`;
        });
      }

      // Combine with static defaults
      const result = `${JOB_KNOWLEDGE_BASE(defaultConfig)}${dynamicContent}`;

      // Cache the result
      this.cache[cacheKey] = result;
      this.lastFetch[cacheKey] = now;

      return result;
    } catch (error) {
      console.error('Error fetching dynamic knowledge base:', error);
      return JOB_KNOWLEDGE_BASE(defaultConfig); // Fallback to static
    }
  }

  /**
   * Cache Management
   */
  public getCacheStats() {
    return {
      keys: Object.keys(this.cache).length,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  public clearCache() {
    const count = Object.keys(this.cache).length;
    this.cache = {};
    this.lastFetch = {};
    console.log(`🧹 ConfigService cache cleared (${count} items removed)`);
    return count;
  }

  /**
   * Get Countries for Job Placement
   * Configure via Admin Panel > Datasets > COUNTRIES
   */
  public async getCountries(): Promise<CountryOption[]> {
    const countries = await this.get('COUNTRIES', DEFAULT_COUNTRIES);
    if (Array.isArray(countries) && countries.length > 0) {
      return countries;
    }
    return DEFAULT_COUNTRIES;
  }

  /**
   * Get Experience Levels
   * Configure via Admin Panel > Datasets > EXPERIENCE_LEVELS
   */
  public async getExperienceLevels(): Promise<ExperienceOption[]> {
    const levels = await this.get(
      'EXPERIENCE_LEVELS',
      DEFAULT_EXPERIENCE_LEVELS,
    );
    if (Array.isArray(levels) && levels.length > 0) {
      return levels;
    }
    return DEFAULT_EXPERIENCE_LEVELS;
  }

  // ============================================
  // MESSAGE TEMPLATES (All from Datasets)
  // ============================================

  /**
   * Get Help Message Template
   * Configure via Admin Panel > Datasets > HELP_MESSAGE
   */
  public async getHelpMessage(): Promise<{
    title: string;
    subtitle: string;
    commands: string[];
    footer: string;
  }> {
    const template = await this.get('HELP_MESSAGE', {
      title: '',
      subtitle: '',
      commands: [],
      footer: '',
    });
    return template;
  }

  /**
   * Get Jobs Message Template
   * Configure via Admin Panel > Datasets > JOBS_MESSAGE
   */
  public async getJobsMessage(): Promise<{
    title: string;
    jobs: Array<{ emoji: string; title: string; count: string }>;
    footer: string;
  }> {
    const template = await this.get('JOBS_MESSAGE', {
      title: '',
      jobs: [],
      footer: '',
    });
    return template;
  }

  /**
   * Get Clear Message
   * Configure via Admin Panel > Datasets > CLEAR_MESSAGE
   */
  public async getClearMessage(): Promise<string> {
    const config = await this.get('CLEAR_MESSAGE', { message: '' });
    return (
      config.message ||
      '⚠️ Clear message not configured. Configure via Admin Panel > Datasets > CLEAR_MESSAGE'
    );
  }

  /**
   * Get Ping Message
   * Configure via Admin Panel > Datasets > PING_MESSAGE
   */
  public async getPingMessage(): Promise<string> {
    const config = await this.get('PING_MESSAGE', { message: '' });
    return (
      config.message ||
      '⚠️ Ping message not configured. Configure via Admin Panel > Datasets > PING_MESSAGE'
    );
  }

  /**
   * Get Unknown Command Message
   * Configure via Admin Panel > Datasets > UNKNOWN_COMMAND_MESSAGE
   */
  public async getUnknownCommandMessage(command: string): Promise<string> {
    const config = await this.get('UNKNOWN_COMMAND_MESSAGE', { message: '' });
    if (config.message) {
      return config.message.replace('{command}', command);
    }
    return `⚠️ Unknown command: \`${command}\`\n\nConfigure via Admin Panel > Datasets > UNKNOWN_COMMAND_MESSAGE`;
  }

  /**
   * Get Welcome Message
   * Configure via Admin Panel > Datasets > WELCOME_MESSAGE
   */
  public async getWelcomeMessage(): Promise<string> {
    const config = await this.get('WELCOME_MESSAGE', { message: '' });
    return config.message || '';
  }

  /**
   * Get Stop Auto-Registration Message
   * Configure via Admin Panel > Datasets > STOP_MESSAGE
   */
  public async getStopMessage(): Promise<string> {
    const config = await this.get('STOP_MESSAGE', { message: '' });
    return (
      config.message ||
      '⚠️ Stop message not configured. Configure via Admin Panel > Datasets > STOP_MESSAGE'
    );
  }

  /**
   * Get Start Auto-Registration Message
   * Configure via Admin Panel > Datasets > START_MESSAGE
   */
  public async getStartMessage(): Promise<string> {
    const config = await this.get('START_MESSAGE', { message: '' });
    return (
      config.message ||
      '⚠️ Start message not configured. Configure via Admin Panel > Datasets > START_MESSAGE'
    );
  }

  /**
   * Get the lead-intake fallback templates used when AI providers are down.
   * Configure via Admin Panel > Datasets > LEAD_FALLBACK_TEMPLATES.
   * Each template supports {name}, {country}, {phone} placeholders.
   *
   * Empty defaults: operators MUST configure each slot. The caller is
   * responsible for checking whether the returned slot is empty and
   * handling that case (typically: log and skip the reply).
   */
  public async getLeadFallbackTemplates(): Promise<LeadFallbackTemplates> {
    const config = await this.get(
      'LEAD_FALLBACK_TEMPLATES',
      EMPTY_LEAD_FALLBACK_TEMPLATES,
    );
    // Merge so missing keys from a partial admin edit fall back to empty
    // (not undefined) — caller can safely check `template === ''`.
    return { ...EMPTY_LEAD_FALLBACK_TEMPLATES, ...config };
  }
}

export const configService = ConfigService.Instance;
