import Dataset from '../models/Dataset';
import {
  configService,
  HumanizerConfig,
  CompanyInfo,
  BookingConfig,
  CountryOption,
  ExperienceOption,
} from './ConfigService';

// Re-export types for convenience. `export type` is required under
// isolatedModules (these are types, erased at compile time).
export type {
  HumanizerConfig,
  CompanyInfo,
  BookingConfig,
  CountryOption,
  ExperienceOption,
};

export interface ConfigurationManager {
  // Humanizer configuration
  humanizerConfig: {
    enabled: boolean;
    maxQueueSize: number;
    maxRetries: number;
    retryDelayMs: number;
    reactionDelayMin: number;
    reactionDelayMax: number;
    typingSpeedCharsPerMin: number;
    minTypingDelayMs: number;
    maxTypingDelayMs: number;
  };

  // Company information
  companyInfo: {
    name: string;
    contact: string;
    address: string;
    email?: string;
  };

  // Booking configuration
  bookingConfig: {
    campusLocation: string;
    organizerName: string;
    organizerEmail: string;
    eventTitle: string;
    eventDescription: string;
    workHoursStart: number;
    workHoursEnd: number;
    eventDurationHours: number;
    acceptanceKeywords: string[];
  };

  // Job types for lead registration
  jobTypes: string[];

  // Booking keywords
  bookingKeywords: string[];

  // Conversation examples
  conversationExamples: Array<{
    user: string;
    assistant: string;
  }>;

  // AI personality and knowledge base
  aiPersonality: string;
  aiKnowledgeBase: string;
}

export class ConfigurationManagerService {
  private static instance: ConfigurationManagerService;
  private cache: Map<string, any> = new Map();
  private cacheExpiry: Map<string, number> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): ConfigurationManagerService {
    if (!ConfigurationManagerService.instance) {
      ConfigurationManagerService.instance = new ConfigurationManagerService();
    }
    return ConfigurationManagerService.instance;
  }

  private isCacheValid(key: string): boolean {
    const expiry = this.cacheExpiry.get(key);
    return expiry !== undefined && expiry > Date.now();
  }

  private setCache(key: string, value: any, ttl = 60000): void {
    // 1 minute default
    this.cache.set(key, value);
    this.cacheExpiry.set(key, Date.now() + ttl);
  }

  /**
   * Get humanizer configuration
   */
  async getHumanizerConfig(): Promise<ConfigurationManager['humanizerConfig']> {
    const cacheKey = 'humanizerConfig';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const config = await configService.getHumanizerConfig();
      this.setCache(cacheKey, config);
      return config;
    } catch (error) {
      console.error('Error fetching humanizer config:', error);

      // Return default fallback
      const defaultConfig = {
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

      this.setCache(cacheKey, defaultConfig);
      return defaultConfig;
    }
  }

  /**
   * Get company information
   */
  async getCompanyInfo(): Promise<ConfigurationManager['companyInfo']> {
    const cacheKey = 'companyInfo';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const info = await configService.getCompanyInfo();

      // Check if company info is properly configured
      if (!info.name && !info.contact && !info.address) {
        console.warn('⚠️ COMPANY_INFO not configured in Admin Panel');
      }

      this.setCache(cacheKey, info);
      return info;
    } catch (error) {
      console.error('Error fetching company info:', error);

      // Return empty object - must be configured
      const emptyInfo = {
        name: '',
        contact: '',
        address: '',
        email: '',
      };

      this.setCache(cacheKey, emptyInfo);
      return emptyInfo;
    }
  }

  /**
   * Get booking configuration
   */
  async getBookingConfig(): Promise<ConfigurationManager['bookingConfig']> {
    const cacheKey = 'bookingConfig';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const config = await configService.getBookingConfig();

      // Check if booking config is properly configured
      if (!config.campusLocation || !config.organizerName) {
        console.warn('⚠️ BOOKING_CONFIG not configured in Admin Panel');
      }

      this.setCache(cacheKey, config);
      return config;
    } catch (error) {
      console.error('Error fetching booking config:', error);

      // Return empty config - must be configured
      const emptyConfig = {
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

      this.setCache(cacheKey, emptyConfig);
      return emptyConfig;
    }
  }

  /**
   * Get job types for lead registration
   */
  async getJobTypes(): Promise<ConfigurationManager['jobTypes']> {
    const cacheKey = 'jobTypes';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const jobTypes = await configService.getJobTypes();

      // Check if job types are configured
      if (!jobTypes || jobTypes.length === 0) {
        console.warn('⚠️ JOB_TYPES not configured in Admin Panel');
      }

      this.setCache(cacheKey, jobTypes || []);
      return jobTypes || [];
    } catch (error) {
      console.error('Error fetching job types:', error);

      // Return empty array - must be configured
      this.setCache(cacheKey, []);
      return [];
    }
  }

  /**
   * Get booking keywords
   */
  async getBookingKeywords(): Promise<ConfigurationManager['bookingKeywords']> {
    const cacheKey = 'bookingKeywords';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const keywords = await configService.getBookingKeywords();
      this.setCache(cacheKey, keywords);
      return keywords;
    } catch (error) {
      console.error('Error fetching booking keywords:', error);

      const defaultKeywords = [
        'tomorrow',
        'today',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
        'am',
        'pm',
        'morning',
        'afternoon',
        'evening',
        'visit',
        'appointment',
        'schedule',
        'book',
        'meet',
        'හෙට',
        'අද',
        'පැමිණ',
        'හමුවීම',
        'වේලාව',
      ];

      this.setCache(cacheKey, defaultKeywords);
      return defaultKeywords;
    }
  }

  /**
   * Get conversation examples
   */
  async getConversationExamples(): Promise<
    ConfigurationManager['conversationExamples']
  > {
    const cacheKey = 'conversationExamples';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const examples = await configService.getConversationExamples();
      this.setCache(cacheKey, examples);
      return examples;
    } catch (error) {
      console.error('Error fetching conversation examples:', error);

      const defaultExamples = [
        {
          user: 'Tell me about services.',
          assistant: 'We offer training and job placement services.',
        },
      ];

      this.setCache(cacheKey, defaultExamples);
      return defaultExamples;
    }
  }

  /**
   * Get AI personality
   */
  async getAIPersonality(): Promise<string> {
    const cacheKey = 'aiPersonality';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const personality = await configService.getAIPersonality();
      this.setCache(cacheKey, personality);
      return personality;
    } catch (error) {
      console.error('Error fetching AI personality:', error);
      // Generic, brand-neutral fallback. The previous string leaked the
      // original operator name ("Jayalath Global") to any tenant whose
      // AI_PERSONALITY dataset row was missing or empty. We return a
      // neutral one-liner instead and let the operator override it via
      // Admin Panel > Datasets > AI_PERSONALITY.
      const defaultPersonality =
        'You are a helpful AI assistant. Respond professionally and concisely.';
      this.setCache(cacheKey, defaultPersonality);
      return defaultPersonality;
    }
  }

  /**
   * Get AI knowledge base
   */
  async getAIKnowledgeBase(tenantId?: unknown): Promise<string> {
    // Namespace the cache by tenant so a per-tenant KB isn't served globally.
    const cacheKey = tenantId
      ? `aiKnowledgeBase:${String(tenantId)}`
      : 'aiKnowledgeBase';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const kb = await configService.getDynamicKnowledgeBase(tenantId);
      this.setCache(cacheKey, kb);
      return kb;
    } catch (error) {
      console.error('Error fetching AI knowledge base:', error);

      const defaultKB =
        '# Knowledge Base\nThis is the default knowledge base content.';
      this.setCache(cacheKey, defaultKB);
      return defaultKB;
    }
  }

  /**
   * Update configuration in database and clear cache
   */
  async updateConfiguration(key: string, content: any): Promise<boolean> {
    try {
      // Check if dataset exists
      let dataset = await Dataset.findOne({ key });

      if (dataset) {
        // Update existing
        dataset.content = content;
        dataset.updatedAt = new Date();
        await dataset.save();
      } else {
        // Create new
        dataset = new Dataset({
          key,
          name: this.formatKeyName(key),
          category: 'config',
          content,
          description: `Configuration for ${this.formatKeyName(key)}`,
          isActive: true,
        });
        await dataset.save();
      }

      // Clear cache for this key
      this.cache.delete(key);
      this.cacheExpiry.delete(key);

      return true;
    } catch (error) {
      console.error(`Error updating configuration ${key}:`, error);
      return false;
    }
  }

  /**
   * Format key name for display
   */
  private formatKeyName(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase());
  }

  /**
   * Get all configuration as a single object
   */
  async getAllConfiguration(): Promise<ConfigurationManager> {
    const [
      humanizerConfig,
      companyInfo,
      bookingConfig,
      jobTypes,
      bookingKeywords,
      conversationExamples,
      aiPersonality,
    ] = await Promise.all([
      this.getHumanizerConfig(),
      this.getCompanyInfo(),
      this.getBookingConfig(),
      this.getJobTypes(),
      this.getBookingKeywords(),
      this.getConversationExamples(),
      this.getAIPersonality(),
    ]);

    return {
      humanizerConfig,
      companyInfo,
      bookingConfig,
      jobTypes,
      bookingKeywords,
      conversationExamples,
      aiPersonality,
      aiKnowledgeBase: await this.getAIKnowledgeBase(),
    };
  }

  /**
   * Clear all configuration caches
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheExpiry.clear();
    configService.clearCache(); // Also clear the base config service cache
  }

  /**
   * Get countries for job placement
   */
  async getCountries(): Promise<CountryOption[]> {
    const cacheKey = 'countries';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const countries = await configService.getCountries();

      // Check if countries are configured
      if (!countries || countries.length === 0) {
        console.warn('⚠️ COUNTRIES not configured in Admin Panel');
      }

      this.setCache(cacheKey, countries || []);
      return countries || [];
    } catch (error) {
      console.error('Error fetching countries:', error);
      return [];
    }
  }

  /**
   * Get experience levels
   */
  async getExperienceLevels(): Promise<ExperienceOption[]> {
    const cacheKey = 'experienceLevels';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const levels = await configService.getExperienceLevels();

      // Check if experience levels are configured
      if (!levels || levels.length === 0) {
        console.warn('⚠️ EXPERIENCE_LEVELS not configured in Admin Panel');
      }

      this.setCache(cacheKey, levels || []);
      return levels || [];
    } catch (error) {
      console.error('Error fetching experience levels:', error);
      return [];
    }
  }

  // ============================================
  // MESSAGE TEMPLATES (All from Datasets)
  // ============================================

  /**
   * Get Help Message Template
   */
  async getHelpMessage(): Promise<{
    title: string;
    subtitle: string;
    commands: string[];
    footer: string;
  }> {
    const cacheKey = 'helpMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const template = await configService.getHelpMessage();
      this.setCache(cacheKey, template);
      return template;
    } catch (error) {
      console.error('Error fetching help message:', error);
      return { title: 'Help', subtitle: '', commands: [], footer: '' };
    }
  }

  /**
   * Get Jobs Message Template
   */
  async getJobsMessage(): Promise<{
    title: string;
    jobs: Array<{ emoji: string; title: string; count: string }>;
    footer: string;
  }> {
    const cacheKey = 'jobsMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const template = await configService.getJobsMessage();
      this.setCache(cacheKey, template);
      return template;
    } catch (error) {
      console.error('Error fetching jobs message:', error);
      return { title: 'Available Jobs', jobs: [], footer: '' };
    }
  }

  /**
   * Get Clear Message
   */
  async getClearMessage(): Promise<string> {
    return await configService.getClearMessage();
  }

  /**
   * Get Ping Message
   */
  async getPingMessage(): Promise<string> {
    return await configService.getPingMessage();
  }

  /**
   * Get Unknown Command Message
   */
  async getUnknownCommandMessage(command: string): Promise<string> {
    return await configService.getUnknownCommandMessage(command);
  }

  /**
   * Get Welcome Message
   */
  async getWelcomeMessage(): Promise<string> {
    return await configService.getWelcomeMessage();
  }

  /**
   * Get Stop Auto-Registration Message
   */
  async getStopMessage(): Promise<string> {
    return await configService.getStopMessage();
  }

  /**
   * Get Start Auto-Registration Message
   */
  async getStartMessage(): Promise<string> {
    return await configService.getStartMessage();
  }
}

export const configurationManager = ConfigurationManagerService.getInstance();
