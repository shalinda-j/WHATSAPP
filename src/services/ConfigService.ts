import Dataset from '../models/Dataset';
import {
    getRegistrationMessage,
    getPaymentMessage,
    getCVMessage,
} from '../config/links-config';
import { AI_PERSONALITY, JOB_KNOWLEDGE_BASE } from '../config/ai-personality';
import { createCompanyConfig } from '../config/companies';

const defaultConfig = createCompanyConfig('default');

export class ConfigService {
    private static instance: ConfigService;
    // Simple in-memory cache to avoid DB hits on every message
    private cache: Record<string, any> = {};
    private cacheTTL = 60 * 1000; // 1 minute
    private lastFetch: Record<string, number> = {};

    private constructor() { }

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
                this.cache[key] = dataset.content;
                this.lastFetch[key] = now;
                return dataset.content;
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
            // Avoid circular dependency if Config is imported? No, ConfigService imports Dataset.
            // We need to import Config model. But ConfigService.ts imports Dataset.
            // Let's import Config at top of file.
            const config = await import('../models/Config').then((m) =>
                m.default.findOne({
                    isProvider: true,
                    providerType: 'google',
                    isActive: true,
                }),
            );
            return config?.apiKey;
        } catch (error) {
            console.error('Error fetching Google Provider Key:', error);
            return undefined;
        }
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
            // Fetch all active datasets
            const datasets = await Dataset.find({ isActive: true });

            let dynamicContent = '';
            if (datasets.length > 0) {
                dynamicContent = '\n\n# 📂 Dynamic Datasets (From Admin Panel)\n';
                datasets.forEach((ds: any) => {
                    // Handle both string and object content
                    const content =
                        typeof ds.content === 'string'
                            ? ds.content
                            : JSON.stringify(ds.content, null, 2);
                    dynamicContent += `\n## ${ds.name} (${ds.scope || ds.category
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
}

export const configService = ConfigService.Instance;
