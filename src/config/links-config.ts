import { CompanyConfig } from './types';

/**
 * Links and Payment Configuration
 */

/**
 * Generate registration message from config
 */
export function getRegistrationMessage(config: CompanyConfig): string {
  return config.links.registration.message;
}

/**
 * Generate payment message with actual bank details based on category
 */
export function getPaymentMessage(
  config: CompanyConfig,
  query?: string,
): string {
  if (!query) {
    return config.links.payment.defaultMessage;
  }

  const normalizedQuery = query.toLowerCase().trim();
  const categories = config.links.payment.categories;
  let selectedCategory = categories['general']; // Default fallback

  // Simple search through categories
  for (const key in categories) {
    if (normalizedQuery.includes(key)) {
      selectedCategory = categories[key];
      break;
    }
  }

  if (selectedCategory) {
    const accountsText = selectedCategory.accounts
      .map(
        (acc) =>
          `🏦 *${acc.bankName}* (${acc.branch})\n` +
          `• Account: *${acc.accountNumber}*\n` +
          `• Name: ${acc.accountName}` +
          (acc.accountType ? `\n• Type: ${acc.accountType}` : ''),
      )
      .join('\n\n');

    return `💳 *Payment Details - ${selectedCategory.title}*\n\n` +
      `🏢 *Company:* ${selectedCategory.companyName}\n` +
      `ℹ️ *Purpose:* ${selectedCategory.description}\n\n` +
      `${accountsText}\n\n` +
      `*Important:*\n` +
      `• Send slip after payment.\n` +
      `• Write your name and number on the slip.`;
  }

  return config.links.payment.defaultMessage;
}

/**
 * Generate CV submission message
 */
export function getCVMessage(config: CompanyConfig): string {
  return config.links.cv.message;
}
