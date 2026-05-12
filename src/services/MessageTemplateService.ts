import Dataset from '../models/Dataset';
import { BoundedMap } from '../utils/BoundedMap';

/**
 * MessageTemplateService
 * Provides all bot messages from database
 * NO HARDCODED VALUES - Everything comes from database
 */

export interface HelpMessage {
  title: string;
  subtitle: string;
  commands: Array<{
    command: string;
    description: string;
  }>;
  footer: string;
}

export interface JobsMessage {
  title: string;
  jobs: Array<{
    emoji: string;
    title: string;
    count: string;
  }>;
  footer: string;
}

export class MessageTemplateService {
  private static instance: MessageTemplateService;
  private cacheTTL: number = 60000; // 1 minute
  // Bounded cache — Phase 2 memory-leak fix.
  private cache = new BoundedMap<string, any>({
    maxSize: 200,
    ttlMs: this.cacheTTL,
    cleanupIntervalMs: 5 * 60 * 1000,
  });

  private constructor() {}

  public static getInstance(): MessageTemplateService {
    if (!MessageTemplateService.instance) {
      MessageTemplateService.instance = new MessageTemplateService();
    }
    return MessageTemplateService.instance;
  }

  private isCacheValid(key: string): boolean {
    return this.cache.has(key);
  }

  private setCache(key: string, value: any): void {
    this.cache.set(key, value);
  }

  /**
   * Get help message from database
   */
  async getHelpMessage(): Promise<string> {
    const cacheKey = 'helpMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const dataset = await Dataset.findOne({ key: 'HELP_MESSAGE' });

      if (dataset && dataset.content) {
        const content = dataset.content;
        let message = '';

        if (content.title) {
          message += `${content.title}\n\n`;
        }

        if (content.subtitle) {
          message += `${content.subtitle}\n\n`;
        }

        if (content.commands && Array.isArray(content.commands)) {
          message += `*Available Commands:*\n`;
          for (const cmd of content.commands) {
            message += `• \`${cmd.command}\` - ${cmd.description}\n`;
          }
          message += '\n';
        }

        if (content.footer) {
          message += content.footer;
        }

        this.setCache(cacheKey, message);
        return message;
      }
    } catch (error) {
      console.error('[MessageTemplate] Error getting help message:', error);
    }

    // Empty fallback - admin must configure
    return '⚠️ Help message not configured. Please configure via Admin Panel > Datasets > HELP_MESSAGE';
  }

  /**
   * Get jobs message from database
   */
  async getJobsMessage(): Promise<string> {
    const cacheKey = 'jobsMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const dataset = await Dataset.findOne({ key: 'JOBS_MESSAGE' });

      if (dataset && dataset.content) {
        const content = dataset.content;
        let message = '';

        if (content.title) {
          message += `${content.title}\n\n`;
        }

        if (content.jobs && Array.isArray(content.jobs)) {
          for (const job of content.jobs) {
            message += `${job.emoji || '•'} *${job.title}*`;
            if (job.count) {
              message += ` - ${job.count}`;
            }
            message += '\n';
          }
          message += '\n';
        }

        if (content.footer) {
          message += content.footer;
        }

        this.setCache(cacheKey, message);
        return message;
      }
    } catch (error) {
      console.error('[MessageTemplate] Error getting jobs message:', error);
    }

    return '⚠️ Jobs message not configured. Please configure via Admin Panel > Datasets > JOBS_MESSAGE';
  }

  /**
   * Get clear message from database
   */
  async getClearMessage(): Promise<string> {
    const cacheKey = 'clearMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const dataset = await Dataset.findOne({ key: 'CLEAR_MESSAGE' });

      if (dataset && dataset.content && dataset.content.message) {
        this.setCache(cacheKey, dataset.content.message);
        return dataset.content.message;
      }
    } catch (error) {
      console.error('[MessageTemplate] Error getting clear message:', error);
    }

    return '🗑️ Conversation cleared!';
  }

  /**
   * Get stop message from database
   */
  async getStopMessage(): Promise<string> {
    const cacheKey = 'stopMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const dataset = await Dataset.findOne({ key: 'STOP_MESSAGE' });

      if (dataset && dataset.content && dataset.content.message) {
        this.setCache(cacheKey, dataset.content.message);
        return dataset.content.message;
      }
    } catch (error) {
      console.error('[MessageTemplate] Error getting stop message:', error);
    }

    return '✅ You will no longer receive automatic prompts.';
  }

  /**
   * Get start message from database
   */
  async getStartMessage(): Promise<string> {
    const cacheKey = 'startMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const dataset = await Dataset.findOne({ key: 'START_MESSAGE' });

      if (dataset && dataset.content && dataset.content.message) {
        this.setCache(cacheKey, dataset.content.message);
        return dataset.content.message;
      }
    } catch (error) {
      console.error('[MessageTemplate] Error getting start message:', error);
    }

    return '✅ Automatic prompts re-enabled.';
  }

  /**
   * Get welcome message from database
   */
  async getWelcomeMessage(): Promise<string> {
    const cacheKey = 'welcomeMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const dataset = await Dataset.findOne({ key: 'WELCOME_MESSAGE' });

      if (dataset && dataset.content && dataset.content.message) {
        this.setCache(cacheKey, dataset.content.message);
        return dataset.content.message;
      }
    } catch (error) {
      console.error('[MessageTemplate] Error getting welcome message:', error);
    }

    return '👋 Welcome! How can I help you today?';
  }

  /**
   * Get unknown command message from database
   */
  async getUnknownCommandMessage(command: string): Promise<string> {
    const cacheKey = 'unknownCommandMessage';

    if (this.isCacheValid(cacheKey)) {
      const template = this.cache.get(cacheKey);
      return template.replace('{command}', command);
    }

    try {
      const dataset = await Dataset.findOne({ key: 'UNKNOWN_COMMAND_MESSAGE' });

      if (dataset && dataset.content && dataset.content.message) {
        const template = dataset.content.message;
        this.setCache(cacheKey, template);
        return template.replace('{command}', command);
      }
    } catch (error) {
      console.error('[MessageTemplate] Error getting unknown command message:', error);
    }

    return `❓ Unknown command: \`${command}\`\n\nUse \`!help\` to see available commands.`;
  }

  /**
   * Get ping message from database
   */
  async getPingMessage(): Promise<string> {
    const cacheKey = 'pingMessage';

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const dataset = await Dataset.findOne({ key: 'PING_MESSAGE' });

      if (dataset && dataset.content && dataset.content.message) {
        this.setCache(cacheKey, dataset.content.message);
        return dataset.content.message;
      }
    } catch (error) {
      console.error('[MessageTemplate] Error getting ping message:', error);
    }

    return '🏓 Pong! Bot is online.';
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Stop background cleanup timer (call on graceful shutdown)
   */
  shutdown(): void {
    this.cache.shutdown();
  }
}

export const messageTemplateService = MessageTemplateService.getInstance();
export default messageTemplateService;