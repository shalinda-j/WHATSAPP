import { Router } from 'express';
import { configService } from '../../services/ConfigService';
import { MARKETING_MANAGER_SYSTEM_PROMPT } from '../../config/prompts/marketing';
import { authenticateToken } from '../middleware/auth';
import { withOperatorPersona } from '../../agents/composeSystemPrompt';
import { aiLoadBalancer } from '../../services/AILoadBalancer';

const router = Router();

router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { message, companyId } = req.body;
    // Validate up front so a missing message returns a clear 400 instead of an
    // opaque 500 from deep inside the model SDK.
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const config = configService.getCompanyConfig(companyId || 'default');
    if (!config) {
      return res.status(404).json({ error: 'Company configuration not found' });
    }

    // Scope the KB to the caller's tenant (from the JWT) so a tenant-bound
    // admin's marketing chat can't surface another tenant's knowledge base.
    // Super-admins (no tenantId in token) get the global KB as before.
    const callerTenantId = (req as { user?: { tenantId?: unknown } }).user
      ?.tenantId;
    const dynamicKB =
      await configService.getDynamicKnowledgeBase(callerTenantId);
    // Prepend the operator-configured AI Personality (Admin Panel → Datasets →
    // AI_PERSONALITY) so this marketing chat follows the same brand voice/rules
    // as the rest of the bot instead of a fixed, baked-in CMO persona.
    const systemInstruction = await withOperatorPersona(
      MARKETING_MANAGER_SYSTEM_PROMPT(config, dynamicKB),
    );

    // Route through the load-balancer so marketing chat inherits the SAME
    // multi-provider failover chain (Groq/Gemini/OpenRouter/OpenAI) + 429
    // cooldown as the main bot — instead of a Gemini-ONLY hard-fail that 500'd
    // whenever the Gemini key/quota was missing (e.g. OpenRouter-only setups).
    const raw = await aiLoadBalancer.sendMessageRaw({
      systemPrompt: systemInstruction,
      userMessage: message,
    });

    res.json({ response: raw.text });
  } catch (error: any) {
    console.error('Marketing Manager Error:', error);
    res.status(500).json({
      error: 'Failed to generate marketing response.',
      details: error.message,
    });
  }
});

export default router;
