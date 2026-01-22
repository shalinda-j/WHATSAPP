/**
 * Links and Payment Configuration
 */

export const REGISTRATION_CONFIG = {
    // Registration Links
    forms: {
        israel: 'https://forms.gle/QYmcNAswCa8ZsgkG9',
        japan: 'https://forms.gle/ngHvU95auJ2XopyX6',
        heavy: 'https://forms.gle/h71N2aR8Ve1k31RZ8',
        singapore: 'https://forms.gle/gAs8CX4rQf2ER2zYA'
    },

    // Registration message in Sinhala
    message: `📝 *පාඨමාලා හා රැකියා සඳහා ලියාපදිංචි වන්න*

කරුණාකර ඔබට අදාළ අංශය තෝරා Link එක Click කරන්න:

1. *ඊශ්‍රායල ඉදිකිරීම් රැකියා:*
https://forms.gle/QYmcNAswCa8ZsgkG9

2. *ජපන් භාෂා පාඨමාලාව (04 වන කණ්ඩායම):*
https://forms.gle/ngHvU95auJ2XopyX6

3. *බර වාහන පුහුණු ලියාපදිංචිය:*
https://forms.gle/h71N2aR8Ve1k31RZ8

4. *සිංගප්පූරු රැකියා පුහුණු අයදුම්පත:*
https://forms.gle/gAs8CX4rQf2ER2zYA

*උපදෙස්:*
• අදාළ Link එක වෙත ගොස් form එක සම්පූර්ණ කරන්න.
• ඔබගේ තොරතුරු නිවැරදිව ඇතුළත් කිරීමට වග බලා ගන්න.`
};

// --- Payment Configuration ---

export interface BankAccount {
    bankName: string;
    branch: string;
    accountName: string;
    accountNumber: string;
    accountType?: string; // e.g., 'Savings', 'Current'
}

export interface PaymentCategoryItem {
    id: string;
    title: string;
    description: string;
    companyName: string; // The specific entity name, e.g., JCETI
    accounts: BankAccount[];
}

export const BANK_ACCOUNTS: Record<string, PaymentCategoryItem> = {
    'welding': {
        id: 'welding',
        title: 'Welding / Israel Training / Automotive',
        description: 'වෙල්ඩින්, ඊශ්‍රායල් පුහුණුව, සහ ඔටෝමොබයිල් පාඨමාලා සඳහා',
        companyName: 'Jayalath Construction Equipment Training Institute (Pvt) Ltd (JCETI)',
        accounts: [
            {
                bankName: 'Peoples Bank',
                branch: 'Dematagoda',
                accountName: 'Jayalath Construction Equipment Training Institute',
                accountNumber: '071 2001 6332 1877',
                accountType: 'Savings'
            }
        ]
    },
    'heavy': {
        id: 'heavy',
        title: 'Heavy Machinery / General Construction',
        description: 'හෙවි මැෂිනරි සහ සාමාන්‍ය ඉදිකිරීම් පාඨමාලා සඳහා',
        companyName: 'Jayalath Construction Equipment Training Institute (Pvt) Ltd (JCETI)',
        accounts: [
            {
                bankName: 'Peoples Bank',
                branch: 'Dematagoda',
                accountName: 'Jayalath Construction Equipment Training Institute',
                accountNumber: '071 1001 8332 1877',
                accountType: 'Current'
            }
        ]
    },
    'language': {
        id: 'language',
        title: 'Japanese & Korean Language Courses',
        description: 'ජපන් සහ කොරියන් භාෂා පාඨමාලා සඳහා',
        companyName: 'Jayalath Construction Equipment Training Institute (Pvt) Ltd (JCETI)',
        accounts: [
            {
                bankName: 'Commercial Bank',
                branch: 'Baseline Road',
                accountName: 'Jayalath Construction Equipment Training Institute',
                accountNumber: '1113012809',
                accountType: 'Current'
            }
        ]
    },
    'singapore': {
        id: 'singapore',
        title: 'Singapore Courses & Tests',
        description: 'සිංගප්පූරු පරීක්ෂණ ගාස්තු සහ පාඨමාලා ගාස්තු සඳහා',
        companyName: 'Jayalath Chiu Teng Lanka (Pvt) Ltd',
        accounts: [
            {
                bankName: 'Commercial Bank',
                branch: 'Baseline Road',
                accountName: 'Jayalath Chiu Teng Lanka (Pvt) Ltd',
                accountNumber: '1113019423',
                accountType: 'Current'
            }
        ]
    },
    'israel_job': {
        id: 'israel_job',
        title: 'Israel Placement Fees',
        description: 'ඊශ්‍රායල රැකියා ගාස්තු සඳහා (Placement)',
        companyName: 'Jayalath Multi Trade (Pvt) Ltd',
        accounts: [
            {
                bankName: 'Commercial Bank',
                branch: 'Baseline Road',
                accountName: 'Jayalath Multi Trade (Pvt) Ltd',
                accountNumber: '1000491096'
            }
        ]
    },
    'israel_test': {
        id: 'israel_test',
        title: 'Israel Trade Test Fees',
        description: 'ඊශ්‍රායල වෘත්තීය පරීක්ෂණ (Trade Test) ගාස්තු සඳහා',
        companyName: 'J S W Jayalath',
        accounts: [
            {
                bankName: 'Peoples Bank',
                branch: 'Borella',
                accountName: 'J S W Jayalath',
                accountNumber: '078 2001 8226 7829'
            }
        ]
    }
};

export const PAYMENT_CONFIG = {
    // Default message when no category is selected
    defaultMessage: `💳 *ගෙවීම් විස්තර (Payment Details)*

කරුණාකර ඔබට අදාළ ගෙවීම් කාණ්ඩය තෝරන්න:

1. *Welding / Israel Training / Auto*
👉 \`!payment welding\`

2. *Heavy Machinery / Construction*
👉 \`!payment heavy\`

3. *Language Courses (Japanese/Korean)*
👉 \`!payment language\`

4. *Singapore Courses & Tests*
👉 \`!payment singapore\`

5. *Israel Placement (Job Fees)*
👉 \`!payment israel-job\`

6. *Israel Trade Test*
👉 \`!payment israel-test\`

*වැදගත්:* අදාළ අරමුණ සඳහා නිවැරදි ගිණුම් අංකය භාවිතා කරන්න.`
};

export const CV_CONFIG = {
    // CV submission link
    formUrl: 'https://forms.gle/YOUR_CV_FORM_ID',

    message: `📄 *CV එක submit කරන්න*

👉 *CV Submission Form:*
{{FORM_URL}}

*Upload කළ යුතු ලිපිගොනු:*
• ඔබේ CV (PDF format)
• Service Certificates
• Training Certificates
• Photos/Videos of work

✅ Submit කළ පසු අපි එය පරීක්ෂා කර බලන්නම්.`
};

/**
 * Generate registration message with actual URL
 */
export function getRegistrationMessage(): string {
    return REGISTRATION_CONFIG.message;
}

/**
 * Generate payment message with actual bank details based on category
 */
export function getPaymentMessage(query?: string): string {
    if (!query) {
        return PAYMENT_CONFIG.defaultMessage;
    }

    const normalizedQuery = query.toLowerCase().trim();
    let selectedKey: string | undefined;

    // Simple keyword matching
    if (normalizedQuery.includes('weld') || normalizedQuery.includes('auto') || normalizedQuery.includes('israel train')) selectedKey = 'welding';
    else if (normalizedQuery.includes('heavy') || normalizedQuery.includes('machine') || normalizedQuery.includes('construc')) selectedKey = 'heavy';
    else if (normalizedQuery.includes('lang') || normalizedQuery.includes('japan') || normalizedQuery.includes('kore')) selectedKey = 'language';
    else if (normalizedQuery.includes('singapore')) selectedKey = 'singapore';
    else if (normalizedQuery.includes('israel job') || normalizedQuery.includes('placement')) selectedKey = 'israel_job';
    else if (normalizedQuery.includes('israel test') || normalizedQuery.includes('trade test')) selectedKey = 'israel_test';
    // Direct key match
    else if (BANK_ACCOUNTS[normalizedQuery]) selectedKey = normalizedQuery;

    if (selectedKey && BANK_ACCOUNTS[selectedKey]) {
        const data = BANK_ACCOUNTS[selectedKey];
        const accountsText = data.accounts.map(acc =>
            `🏦 *${acc.bankName}* (${acc.branch})\n` +
            `• ගිණුම: *${acc.accountNumber}*\n` +
            `• නම: ${acc.accountName}` +
            (acc.accountType ? `\n• වර්ගය: ${acc.accountType}` : '')
        ).join('\n\n');

        return `💳 *ගෙවීම් විස්තර - ${data.title}*

🏢 *ආයතනය:* ${data.companyName}
ℹ️ *අරමුණ:* ${data.description}

${accountsText}

*වැදගත්:*
• ගෙවීම් කළ පසු slip එක WhatsApp කරන්න.
• Slip එකේ ඔබේ නම සහ දුරකථන අංකය ලියන්න.`;
    }

    // Default return if no specific match found
    return PAYMENT_CONFIG.defaultMessage;
}

/**
 * Generate CV submission message
 */
export function getCVMessage(): string {
    return CV_CONFIG.message.replace('{{FORM_URL}}', CV_CONFIG.formUrl);
}
