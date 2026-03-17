export interface BankAccount {
  bankName: string;
  branch: string;
  accountName: string;
  accountNumber: string;
  accountType?: string;
}

export interface PaymentCategoryItem {
  id: string;
  title: string;
  description: string;
  companyName: string;
  accounts: BankAccount[];
}

export interface LinksConfig {
  registration: {
    forms: Record<string, string>;
    message: string;
  };
  payment: {
    defaultMessage: string;
    categories: Record<string, PaymentCategoryItem>;
  };
  cv: {
    formUrl: string;
    message: string;
  };
}

export interface BusinessUnit {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  goal: string;
}

export interface AIConfig {
  systemPrompt: string; // The base prompt template
  personality: string; // The personality description
  marketingStrategy: string; // The AIDA model description
  securityInstructions: string;
  knowledgeBase: string; // The specific data for this company
}

export interface CompanyConfig {
  id: string; // unique identifier for the company/instance
  name: string; // e.g. "Jayalath Global"
  businessUnits: BusinessUnit[];
  links: LinksConfig;
  ai: AIConfig;
  // Dynamic prompt generator function
  getSystemPrompt: () => string;
}
