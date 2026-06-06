import { configurationManager } from '../services/ConfigurationManagerService';

/**
 * Prepend the operator-configured AI Personality (Admin Panel → Datasets →
 * AI_PERSONALITY) to a specialist agent's task prompt.
 *
 * WHY: conversational agents (Personalization, LeadQualifier, Deal,
 * ContentRecommender) used to run ONLY their own hardcoded task prompt, so the
 * brand voice / persona / rules the operator set in the admin panel were
 * completely ignored whenever an agent handled a WhatsApp message. This made
 * the bot feel "off-personality" and was the main reason the configured
 * marketing/sales personality appeared to do nothing.
 *
 * The persona is placed FIRST (it governs tone, identity and hard rules) and the
 * agent's task prompt LAST — deliberately, so the agent's output-format contract
 * (most agents must emit strict JSON) stays the most recent, most salient
 * instruction and is still honoured. The persona shapes the WORDING of any
 * customer-facing text the agent produces; it does not change the task or the
 * required output shape.
 *
 * If no personality is configured (or it can't be read), the task prompt is
 * returned unchanged — behaviour is never worse than before.
 */
export async function withOperatorPersona(taskPrompt: string): Promise<string> {
  let persona = '';
  try {
    persona = ((await configurationManager.getAIPersonality()) ?? '').trim();
  } catch {
    persona = '';
  }

  if (!persona) return taskPrompt;

  return [
    '=== BRAND VOICE & PERSONA (operator-configured — ALWAYS follow this identity, tone and rules) ===',
    persona,
    '=== END BRAND VOICE & PERSONA ===',
    '',
    'Apply the persona above to the WORDING and TONE of every customer-facing message you produce.',
    'Then perform the task below EXACTLY as specified, including its required output format.',
    '',
    taskPrompt,
  ].join('\n');
}
