import {
  BookOpen,
  AtSign,
  Camera,
  BriefcaseBusiness,
  CirclePlay,
  Mail,
  MessageCircle,
  Share2,
  Globe,
  Video,
  ShoppingCart,
  CreditCard,
  BarChart,
  Database,
  MessagesSquare,
  FileText,
  type LucideIcon,
} from 'lucide-react';

export interface IntegrationField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
}

export interface IntegrationPreset {
  id: string;
  label: string;
  category: 'Social' | 'CRM' | 'Ads' | 'Ecommerce' | 'Content' | 'Workflow';
  icon?: LucideIcon;
  fields: IntegrationField[];
  description?: string;
}

export const INTEGRATIONS: Record<string, IntegrationPreset> = {
  // --- SOCIAL MEDIA ---
  buffer: {
    id: 'buffer',
    label: 'Buffer',
    category: 'Social',
    icon: Share2,
    fields: [
      { key: 'accessToken', label: 'Access Token', type: 'password' },
      { key: 'profileId', label: 'Profile ID', type: 'text' },
    ],
  },
  hootsuite: {
    id: 'hootsuite',
    label: 'Hootsuite',
    category: 'Social',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  facebook_pages: {
    id: 'facebook_pages',
    label: 'Facebook Pages',
    category: 'Social',
    icon: BookOpen,
    fields: [
      { key: 'pageId', label: 'Page ID', type: 'text' },
      { key: 'accessToken', label: 'Page Access Token', type: 'password' },
    ],
  },
  instagram_business: {
    id: 'instagram_business',
    label: 'Instagram Business',
    category: 'Social',
    icon: Camera,
    fields: [
      { key: 'businessAccountId', label: 'Business Account ID', type: 'text' },
      { key: 'accessToken', label: 'Access Token', type: 'password' },
    ],
  },
  twitter: {
    id: 'twitter',
    label: 'Twitter / X',
    category: 'Social',
    icon: AtSign,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text' },
      { key: 'apiSecret', label: 'API Secret', type: 'password' },
    ],
  },
  linkedin_company: {
    id: 'linkedin_company',
    label: 'LinkedIn Company',
    category: 'Social',
    icon: BriefcaseBusiness,
    fields: [
      { key: 'organizationId', label: 'Organization ID', type: 'text' },
      { key: 'accessToken', label: 'OAuth Token', type: 'password' },
    ],
  },
  tiktok_publish: {
    id: 'tiktok_publish',
    label: 'TikTok Publishing',
    category: 'Social',
    icon: Video,
    fields: [
      { key: 'openId', label: 'Open ID', type: 'text' },
      { key: 'accessToken', label: 'Access Token', type: 'password' },
    ],
  },
  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    category: 'Social',
    fields: [
      { key: 'boardId', label: 'Board ID', type: 'text' },
      { key: 'accessToken', label: 'Access Token', type: 'password' },
    ],
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    category: 'Social',
    icon: CirclePlay,
    fields: [
      { key: 'channelId', label: 'Channel ID', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'password' },
    ],
  },
  telegram_bot: {
    id: 'telegram_bot',
    label: 'Telegram Bot',
    category: 'Social',
    icon: MessageCircle,
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password' },
      { key: 'chatId', label: 'Chat ID', type: 'text' },
    ],
  },
  whatsapp_business: {
    id: 'whatsapp_business',
    label: 'WhatsApp Business',
    category: 'Social',
    icon: MessageCircle,
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text' },
      { key: 'accessToken', label: 'Permanent Token', type: 'password' },
    ],
  },

  // --- CRM & EMAIL ---
  mailchimp: {
    id: 'mailchimp',
    label: 'Mailchimp',
    category: 'CRM',
    icon: Mail,
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password' },
      { key: 'listId', label: 'Audience ID', type: 'text' },
    ],
  },
  sendgrid: {
    id: 'sendgrid',
    label: 'SendGrid',
    category: 'CRM',
    icon: Mail,
    fields: [{ key: 'apiKey', label: 'API Key', type: 'password' }],
  },
  hubspot: {
    id: 'hubspot',
    label: 'HubSpot',
    category: 'CRM',
    icon: Database,
    fields: [
      { key: 'accessToken', label: 'Private App Token', type: 'password' },
    ],
  },
  salesforce: {
    id: 'salesforce',
    label: 'Salesforce',
    category: 'CRM',
    icon: Database,
    fields: [
      { key: 'consumerKey', label: 'Consumer Key', type: 'text' },
      { key: 'consumerSecret', label: 'Consumer Secret', type: 'password' },
    ],
  },
  activecampaign: {
    id: 'activecampaign',
    label: 'ActiveCampaign',
    category: 'CRM',
    fields: [
      { key: 'apiUrl', label: 'API URL', type: 'url' },
      { key: 'apiKey', label: 'API Key', type: 'password' },
    ],
  },
  klaviyo: {
    id: 'klaviyo',
    label: 'Klaviyo',
    category: 'CRM',
    fields: [
      { key: 'publicKey', label: 'Public Key', type: 'text' },
      { key: 'privateKey', label: 'Private Key', type: 'password' },
    ],
  },
  convertkit: {
    id: 'convertkit',
    label: 'ConvertKit',
    category: 'CRM',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text' },
      { key: 'apiSecret', label: 'API Secret', type: 'password' },
    ],
  },
  zoho_crm: {
    id: 'zoho_crm',
    label: 'Zoho CRM',
    category: 'CRM',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },

  // --- ADS & TRACKING (PIXELS) ---
  meta_pixel: {
    id: 'meta_pixel',
    label: 'Meta Pixel',
    category: 'Ads',
    icon: BookOpen,
    fields: [
      { key: 'pixelId', label: 'Pixel ID', type: 'text' },
      { key: 'accessToken', label: 'Conversions API Token', type: 'password' },
    ],
  },
  tiktok_pixel: {
    id: 'tiktok_pixel',
    label: 'TikTok Pixel',
    category: 'Ads',
    icon: Video,
    fields: [
      { key: 'pixelId', label: 'Pixel ID', type: 'text' },
      { key: 'accessToken', label: 'Access Token', type: 'password' },
    ],
  },
  google_ads: {
    id: 'google_ads',
    label: 'Google Ads',
    category: 'Ads',
    icon: BarChart,
    fields: [
      { key: 'customerId', label: 'Customer ID', type: 'text' },
      { key: 'developerToken', label: 'Developer Token', type: 'password' },
    ],
  },
  linkedin_insight: {
    id: 'linkedin_insight',
    label: 'LinkedIn Insight Tag',
    category: 'Ads',
    icon: BriefcaseBusiness,
    fields: [{ key: 'partnerId', label: 'Partner ID', type: 'text' }],
  },
  ga4: {
    id: 'ga4',
    label: 'Google Analytics 4',
    category: 'Ads',
    icon: BarChart,
    fields: [
      { key: 'measurementId', label: 'Measurement ID', type: 'text' },
      { key: 'apiSecret', label: 'API Secret', type: 'password' },
    ],
  },
  segment: {
    id: 'segment',
    label: 'Segment',
    category: 'Ads',
    fields: [{ key: 'writeKey', label: 'Write Key', type: 'password' }],
  },

  // --- E-COMMERCE ---
  shopify: {
    id: 'shopify',
    label: 'Shopify',
    category: 'Ecommerce',
    icon: ShoppingCart,
    fields: [
      { key: 'shopUrl', label: 'Shop URL', type: 'url' },
      { key: 'accessToken', label: 'Admin API Token', type: 'password' },
    ],
  },
  woocommerce: {
    id: 'woocommerce',
    label: 'WooCommerce',
    category: 'Ecommerce',
    icon: ShoppingCart,
    fields: [
      { key: 'storeUrl', label: 'Store URL', type: 'url' },
      { key: 'consumerKey', label: 'Consumer Key', type: 'text' },
      { key: 'consumerSecret', label: 'Consumer Secret', type: 'password' },
    ],
  },
  stripe: {
    id: 'stripe',
    label: 'Stripe',
    category: 'Ecommerce',
    icon: CreditCard,
    fields: [
      { key: 'publishableKey', label: 'Publishable Key', type: 'text' },
      { key: 'secretKey', label: 'Secret Key', type: 'password' },
    ],
  },

  // --- WORKFLOW & UTILS ---
  zapier_webhook: {
    id: 'zapier_webhook',
    label: 'Zapier Webhook',
    category: 'Workflow',
    icon: Globe,
    fields: [{ key: 'webhookUrl', label: 'Catch Hook URL', type: 'url' }],
  },
  make_webhook: {
    id: 'make_webhook',
    label: 'Make Webhook',
    category: 'Workflow',
    icon: Globe,
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'url' }],
  },
  slack: {
    id: 'slack',
    label: 'Slack',
    category: 'Workflow',
    icon: MessagesSquare,
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'url' }],
  },
  google_sheets: {
    id: 'google_sheets',
    label: 'Google Sheets',
    category: 'Workflow',
    icon: FileText,
    fields: [
      { key: 'spreadsheetId', label: 'Spreadsheet ID', type: 'text' },
      { key: 'sheetName', label: 'Sheet Name', type: 'text' },
    ],
  },
  notion: {
    id: 'notion',
    label: 'Notion',
    category: 'Workflow',
    fields: [
      { key: 'databaseId', label: 'Database ID', type: 'text' },
      {
        key: 'internalIntegrationToken',
        label: 'Integration Token',
        type: 'password',
      },
    ],
  },
  airtable: {
    id: 'airtable',
    label: 'Airtable',
    category: 'Workflow',
    icon: Database,
    fields: [
      { key: 'baseId', label: 'Base ID', type: 'text' },
      { key: 'pat', label: 'Personal Access Token', type: 'password' },
    ],
  },
};
