import Dataset from '../models/Dataset';
import { configService, HumanizerConfig, CompanyInfo, BookingConfig, CountryOption, ExperienceOption } from './ConfigService';

// Re-export types for convenience
export { HumanizerConfig, CompanyInfo, BookingConfig, CountryOption, ExperienceOption };

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

  private setCache(key: string, value: any, ttl: number = 60000): void { // 1 minute default
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
      this.setCache(cacheKey, info);
      return info;
    } catch (error) {
      console.error('Error fetching company info:', error);

      const defaultInfo = {
        name: 'Jayalath Global',
        contact: '077 123 4567',
        address: 'Main St, Colombo',
        email: 'info@jayalath.com',
      };

      this.setCache(cacheKey, defaultInfo);
      return defaultInfo;
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
      this.setCache(cacheKey, config);
      return config;
    } catch (error) {
      console.error('Error fetching booking config:', error);

      const defaultConfig = {
        campusLocation: 'JCETI Campus, No 33, Main Street, Colombo',
        organizerName: 'Jayalath Institute',
        organizerEmail: 'info@jayalath.com',
        eventTitle: 'Campus Visit - Jayalath Institute',
        eventDescription: 'Introduction and Skill Assessment',
        workHoursStart: 8,
        workHoursEnd: 17,
        eventDurationHours: 1,
        acceptanceKeywords: ['yes', 'ow', 'y', 'ok'],
      };

      this.setCache(cacheKey, defaultConfig);
      return defaultConfig;
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
      this.setCache(cacheKey, jobTypes);
      return jobTypes;
    } catch (error) {
      console.error('Error fetching job types:', error);

      const defaultJobTypes = [
        'Electrician',
        'Plumber',
        'Asphalt Worker',
        'Concrete Pump Driver',
        'Excavator Operator',
        'JCB Operator',
        'Heavy Duty Cleaner',
        'Gypsum Fixer',
        'Tile Fixer',
        'General Worker',
        'Welder',
        'Carpenter',
        'Mason',
        'Painter',
        'AC Technician',
      ];

      this.setCache(cacheKey, defaultJobTypes);
      return defaultJobTypes;
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
  async getConversationExamples(): Promise<ConfigurationManager['conversationExamples']> {
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
        { user: 'Tell me about services.', assistant: 'We offer training and job placement services.' },
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

      const defaultPersonality = "You are a helpful AI assistant for Jayalath Global. Respond in a professional yet friendly manner.";
      this.setCache(cacheKey, defaultPersonality);
      return defaultPersonality;
    }
  }

  /**
   * Get AI knowledge base
   */
  async getAIKnowledgeBase(): Promise<string> {
    const cacheKey = 'aiKnowledgeBase';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const kb = await configService.getDynamicKnowledgeBase();
      this.setCache(cacheKey, kb);
      return kb;
    } catch (error) {
      console.error('Error fetching AI knowledge base:', error);

      const defaultKB = "# Knowledge Base\nThis is the default knowledge base content.";
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
          isActive: true
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
      .replace(/^./, str => str.toUpperCase());
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
      aiPersonality
    ] = await Promise.all([
      this.getHumanizerConfig(),
      this.getCompanyInfo(),
      this.getBookingConfig(),
      this.getJobTypes(),
      this.getBookingKeywords(),
      this.getConversationExamples(),
      this.getAIPersonality()
    ]);

    return {
      humanizerConfig,
      companyInfo,
      bookingConfig,
      jobTypes,
      bookingKeywords,
      conversationExamples,
      aiPersonality,
      aiKnowledgeBase: await this.getAIKnowledgeBase()
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
      this.setCache(cacheKey, countries);
      return countries;
    } catch (error) {
      console.error('Error fetching countries:', error);
      return [
        { code: 'IL', name: 'Israel', flag: '🇮🇱' },
        { code: 'AE', name: 'UAE (Dubai)', flag: '🇦🇪' },
        { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
        { code: 'OTHER', name: 'Other', flag: '🌍' },
      ];
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
      this.setCache(cacheKey, levels);
      return levels;
    } catch (error) {
      console.error('Error fetching experience levels:', error);
      return [
        { value: '0-1', label: '0-1 years (Fresher)' },
        { value: '1-3', label: '1-3 years' },
        { value: '3-5', label: '3-5 years' },
        { value: '5+', label: '5+ years' },
      ];
    }
  }
}

export const configurationManager = ConfigurationManagerService.getInstance();