import Dataset from '../models/Dataset';
import { createCompanyConfig } from '../config/companies';
import { AI_PERSONALITY } from '../config/ai-personality';

const defaultConfig = createCompanyConfig('default');

export const seedDatasets = async () => {
    try {
        console.log('🌱 Checking Dataset Seeds...');

        const seeds = [
            {
                key: 'REGISTRATION_CONFIG',
                name: 'Registration Links',
                category: 'config',
                content: defaultConfig.links.registration,
                description: 'Links and messages for course registration',
            },
            {
                key: 'PAYMENT_CONFIG',
                name: 'Payment Instructions',
                category: 'config',
                content: defaultConfig.links.payment,
                description: 'General payment instructions and messages',
            },
            {
                key: 'CV_CONFIG',
                name: 'CV Submission',
                category: 'config',
                content: defaultConfig.links.cv,
                description: 'Settings for CV upload workflow',
            },
            {
                key: 'BANK_ACCOUNTS',
                name: 'Bank Accounts',
                category: 'finance',
                content: defaultConfig.links.payment.categories,
                description: 'Bank account details by category',
            },
            {
                key: 'AI_PERSONALITY',
                name: 'AI Personality',
                category: 'ai',
                content: AI_PERSONALITY(defaultConfig),
                description: 'System prompt and personality settings',
            },
            {
                key: 'COMPANY_INFO',
                name: 'Company Information',
                category: 'info',
                content: {
                    name: defaultConfig.name,
                    contact: '077 123 4567',
                    address: 'Main St, Colombo',
                },
                description: 'General company contact details',
            },
        ];

        for (const seed of seeds) {
            const existing = await Dataset.findOne({ key: seed.key });
            if (!existing) {
                await Dataset.create(seed);
                console.log(`   ✅ Seeded Dataset: ${seed.name}`);
            }
        }
    } catch (error) {
        console.error('❌ Error Seeding Datasets:', error);
    }
};
