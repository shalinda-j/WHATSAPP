/**
 * Links and Payment Configuration
 * Edit these values with your actual details
 */

export const REGISTRATION_CONFIG = {
    // Google Form for job registration
    formUrl: 'https://forms.gle/YOUR_FORM_ID_HERE',

    // Registration message in Sinhala
    message: `📝 *රැකියා සඳහා ලියාපදිංචි වන්න!*

👉 *Registration Form:*
{{FORM_URL}}

*ලියාපදිංචි වීමට:*
1. ඉහත link එක click කරන්න
2. ඔබේ විස්තර පුරවන්න
3. Submit කරන්න

✅ ඔබව අපි ඉක්මනින් සම්බන්ධ කරගනිමු!`
};

export const PAYMENT_CONFIG = {
    // Bank details
    bankName: 'Bank of Ceylon',
    accountName: 'JAYALATH OVERSEAS VOCATIONAL TRAINING',
    accountNumber: '1234567890',
    branch: 'Head Office',

    // Alternative payment methods
    qrCodeUrl: '', // Optional: URL to QR code image

    // Payment message in Sinhala
    message: `💳 *ගෙවීම් විස්තර (Payment Details)*

🏦 *බැංකු තොරතුරු:*
• *බැංකුව:* {{BANK_NAME}}
• *ගිණුම් නම:* {{ACCOUNT_NAME}}
• *ගිණුම් අංකය:* {{ACCOUNT_NUMBER}}
• *ශාඛාව:* {{BRANCH}}

⚠️ *වැදගත්:*
• ගෙවීම් කළ පසු slip එක WhatsApp කරන්න
• ඔබේ නම සහ phone number ලියන්න

💰 *ගාස්තු:*
• Trade Test: රු. 3,000
• Video: රු. 2,000
• NVQ Level 4: රු. 8,000`
};

export const CV_CONFIG = {
    // CV submission link
    formUrl: 'https://forms.gle/YOUR_CV_FORM_ID',

    message: `📄 *CV එක submit කරන්න!*

👉 *CV Submission Form:*
{{FORM_URL}}

*Upload කරන්න:*
• ඔබේ CV (PDF format)
• Service Certificates
• Training Certificates
• Photos/Videos of work

✅ Submit කළ පසු අපි review කරන්නම්!`
};

/**
 * Generate registration message with actual URL
 */
export function getRegistrationMessage(): string {
    return REGISTRATION_CONFIG.message.replace('{{FORM_URL}}', REGISTRATION_CONFIG.formUrl);
}

/**
 * Generate payment message with actual bank details
 */
export function getPaymentMessage(): string {
    return PAYMENT_CONFIG.message
        .replace('{{BANK_NAME}}', PAYMENT_CONFIG.bankName)
        .replace('{{ACCOUNT_NAME}}', PAYMENT_CONFIG.accountName)
        .replace('{{ACCOUNT_NUMBER}}', PAYMENT_CONFIG.accountNumber)
        .replace('{{BRANCH}}', PAYMENT_CONFIG.branch);
}

/**
 * Generate CV submission message
 */
export function getCVMessage(): string {
    return CV_CONFIG.message.replace('{{FORM_URL}}', CV_CONFIG.formUrl);
}
