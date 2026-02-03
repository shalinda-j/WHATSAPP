import Dataset from '../models/Dataset';
import {
    REGISTRATION_CONFIG,
    PAYMENT_CONFIG,
    CV_CONFIG,
    BANK_ACCOUNTS,
} from '../config/links-config';
import { AI_PERSONALITY } from '../config/ai-personality';
import {
    JCETI_DATA,
    SINGAPORE_DATA,
    ISRAEL_DATA,
    GLOBAL_WORKFORCE_DATA
} from '../config/companies';

export const seedDatasets = async () => {
    try {
        console.log('🌱 Checking Dataset Seeds...');

        const seeds = [
            {
                key: 'REGISTRATION_CONFIG',
                name: 'Registration Links',
                category: 'config',
                content: REGISTRATION_CONFIG,
                description: 'Links and messages for course registration',
            },
            {
                key: 'PAYMENT_CONFIG',
                name: 'Payment Instructions',
                category: 'config',
                content: PAYMENT_CONFIG,
                description: 'General payment instructions and messages',
            },
            {
                key: 'CV_CONFIG',
                name: 'CV Submission',
                category: 'config',
                content: CV_CONFIG,
                description: 'Settings for CV upload workflow',
            },
            {
                key: 'BANK_ACCOUNTS',
                name: 'Bank Accounts',
                category: 'finance',
                content: BANK_ACCOUNTS,
                description: 'Bank account details by category',
            },
            {
                key: 'AI_PERSONALITY',
                name: 'AI Personality',
                category: 'ai',
                content: AI_PERSONALITY,
                description: 'System prompt and personality settings',
            },
            {
                key: 'COMPANY_INFO',
                name: 'Company Information',
                category: 'info',
                content: {
                    name: 'Jayalath Group',
                    contact: '077 123 4567',
                    address: 'Main St, Colombo',
                },
                description: 'General company contact details',
            },
            // --- Company Knowledge Base ---
            {
                key: 'COMPANY_JCETI',
                name: 'JCETI Profile',
                category: 'knowledge',
                content: JCETI_DATA,
                description: 'JCETI Campus, courses, fees, and structure',
            },
            {
                key: 'COMPANY_SINGAPORE',
                name: 'Singapore Jobs',
                category: 'knowledge',
                content: SINGAPORE_DATA,
                description: 'Singapore recruitment details and JCT info',
            },
            {
                key: 'COMPANY_ISRAEL',
                name: 'Israel Jobs',
                category: 'knowledge',
                content: ISRAEL_DATA,
                description: 'Israel recruitment details and JOVTI info',
            },
            {
                key: 'COMPANY_GLOBAL_WORKFORCE',
                name: 'Global Workforce',
                category: 'knowledge',
                content: GLOBAL_WORKFORCE_DATA,
                description: 'General global workforce and other country info',
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
