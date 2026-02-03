import Dataset from '../models/Dataset';
import {
    REGISTRATION_CONFIG,
    PAYMENT_CONFIG,
    CV_CONFIG,
    BANK_ACCOUNTS,
} from '../config/links-config';
import { AI_PERSONALITY, JOB_KNOWLEDGE_BASE } from '../config/ai-personality';

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
        return this.get('REGISTRATION_CONFIG', REGISTRATION_CONFIG);
    }

    public async getPaymentConfig() {
        return this.get('PAYMENT_CONFIG', PAYMENT_CONFIG);
    }

    public async getCVConfig() {
        return this.get('CV_CONFIG', CV_CONFIG);
    }

    public async getBankAccounts() {
        return this.get('BANK_ACCOUNTS', BANK_ACCOUNTS);
    }

    public async getAIPersonality() {
        return this.get('AI_PERSONALITY', AI_PERSONALITY);
    }
    public async getRegistrationMessage(): Promise<string> {
        const config = await this.get('REGISTRATION_CONFIG', REGISTRATION_CONFIG);
        return config.message;
    }

    public async getCVMessage(): Promise<string> {
        const config = await this.get('CV_CONFIG', CV_CONFIG);
        return config.message.replace('{{FORM_URL}}', config.formUrl);
    }

    public async getPaymentMessage(query?: string): Promise<string> {
        const paymentConfig = await this.get('PAYMENT_CONFIG', PAYMENT_CONFIG);
        const bankAccounts = await this.get('BANK_ACCOUNTS', BANK_ACCOUNTS);

        if (!query) {
            return paymentConfig.defaultMessage;
        }

        const normalizedQuery = query.toLowerCase().trim();
        let selectedKey: string | undefined;

        // Simple keyword matching
        if (
            normalizedQuery.includes('weld') ||
            normalizedQuery.includes('auto') ||
            normalizedQuery.includes('israel train')
        )
            selectedKey = 'welding';
        else if (
            normalizedQuery.includes('heavy') ||
            normalizedQuery.includes('machine') ||
            normalizedQuery.includes('construc')
        )
            selectedKey = 'heavy';
        else if (
            normalizedQuery.includes('lang') ||
            normalizedQuery.includes('japan') ||
            normalizedQuery.includes('kore')
        )
            selectedKey = 'language';
        else if (normalizedQuery.includes('singapore')) selectedKey = 'singapore';
        else if (
            normalizedQuery.includes('israel job') ||
            normalizedQuery.includes('placement')
        )
            selectedKey = 'israel_job';
        else if (
            normalizedQuery.includes('israel test') ||
            normalizedQuery.includes('trade test')
        )
            selectedKey = 'israel_test';
        // Direct key match
        else if (bankAccounts[normalizedQuery]) selectedKey = normalizedQuery;

        if (selectedKey && bankAccounts[selectedKey]) {
            const data = bankAccounts[selectedKey];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const accountsText = data.accounts
                .map(
                    (acc: any) =>
                        `🏦 *${acc.bankName}* (${acc.branch})\n` +
                        `• ගිණුම: *${acc.accountNumber}*\n` +
                        `• නම: ${acc.accountName}` +
                        (acc.accountType ? `\n• වර්ගය: ${acc.accountType}` : ''),
                )
                .join('\n\n');

            return `💳 *ගෙවීම් විස්තර - ${data.title}*

🏢 *ආයතනය:* ${data.companyName}
ℹ️ *අරමුණ:* ${data.description}

${accountsText}

*වැදගත්:*
• ගෙවීම් කළ පසු slip එක WhatsApp කරන්න.
• Slip එකේ ඔබේ නම සහ දුරකථන අංකය ලියන්න.`;
        }

        return paymentConfig.defaultMessage;
    }

    public async getDynamicKnowledgeBase(): Promise<string> {
        const cacheKey = 'DYNAMIC_KB';
        const now = Date.now();

        // Check cache
        if (this.cache[cacheKey] && now - (this.lastFetch[cacheKey] || 0) < this.cacheTTL) {
            return this.cache[cacheKey];
        }

        try {
            // Fetch all active datasets
            const datasets = await Dataset.findOne({ isActive: true });

            let dynamicContent = '';
            if (datasets.length > 0) {
                dynamicContent = '\n\n# 📂 Dynamic Datasets (From Admin Panel)\n';
                datasets.forEach((ds: any) => {
                    // Handle both string and object content
                    const content = typeof ds.content === 'string'
                        ? ds.content
                        : JSON.stringify(ds.content, null, 2);
                    dynamicContent += `\n## ${ds.name} (${ds.scope || ds.category})\n${content}\n---\n`;
                });
            }

            // Combine with static defaults
            const result = `${JOB_KNOWLEDGE_BASE}${dynamicContent}`;

            // Cache the result
            this.cache[cacheKey] = result;
            this.lastFetch[cacheKey] = now;

            return result;
        } catch (error) {
            console.error('Error fetching dynamic knowledge base:', error);
            return JOB_KNOWLEDGE_BASE; // Fallback to static
        }
    }
}

export const configService = ConfigService.Instance;
