import { CompanyConfig } from './types';
import { configService, ConversationExample } from '../services/ConfigService';

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

// Default conversation examples (fallback)
const DEFAULT_CONVERSATION_EXAMPLES: ConversationExample[] = [
  {
    user: 'Tell me about services.',
    assistant: 'We offer training and job placement services.',
  },
];

/**
 * Get conversation examples for AI training
 * Can be configured dynamically via admin panel (CONVERSATION_EXAMPLES dataset)
 */
export async function getConversationExamples(): Promise<
  ConversationExample[]
> {
  try {
    const examples = await configService.getConversationExamples();
    return examples.length > 0 ? examples : DEFAULT_CONVERSATION_EXAMPLES;
  } catch (error) {
    console.error('Error fetching conversation examples:', error);
    return DEFAULT_CONVERSATION_EXAMPLES;
  }
}

// Legacy export for backward compatibility (static fallback)
export const CONVERSATION_EXAMPLES = DEFAULT_CONVERSATION_EXAMPLES;
