import { CompanyConfig } from './types';

/**
 * AI Personality Configuration
 *
 * This file is now a facade that delegates to the CompanyConfig.
 */

export const JOB_KNOWLEDGE_BASE = (config: CompanyConfig) => `
# 🌍 Knowledge Base (Company: ${config.name})
${config.ai.knowledgeBase}
`;

// --- Personality Definitions ---

export const SECURITY_INSTRUCTIONS = (config: CompanyConfig) =>
  config.ai.securityInstructions;

// --- Sales & Marketing Guidelines (AIDA Model) ---
const MARKETING_STRATEGY = (config: CompanyConfig) =>
  config.ai.marketingStrategy;

// 1. Consultant Persona (Updated for Multi-Company Strategy)
export const AI_PERSONALITY = (config: CompanyConfig) => config.ai.personality;

export const SINHALA_SYSTEM_PROMPT = (config: CompanyConfig) =>
  config.getSystemPrompt();

export const CONVERSATION_EXAMPLES = [
  {
    user: 'Tell me about services.',
    assistant: 'We offer training and job placement services.',
  },
];
