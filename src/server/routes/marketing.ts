import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { configService } from '../../services/ConfigService';
import { MARKETING_MANAGER_SYSTEM_PROMPT } from '../../config/prompts/marketing';
import { authenticateToken } from '../middleware/auth';
import { GEMINI_DEFAULT_MODEL } from '../../config/brand';
import { withOperatorPersona } from '../../agents/composeSystemPrompt';

const router = Router();

router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { message, companyId } = req.body;
    // Use the new public method
    const config = configService.getCompanyConfig(companyId || 'default');

    if (!config) {
      return res.status(404).json({ error: 'Company configuration not found' });
    }

    const apiKey = await configService.getGoogleProviderKey();
    const validKey = apiKey || process.env.GEMINI_API_KEY;

    if (!validKey) {
      return res
        .status(500)
        .json({ error: 'Gemini API Key is not configured.' });
    }

    const dynamicKB = await configService.getDynamicKnowledgeBase();
    // Prepend the operator-configured AI Personality (Admin Panel → Datasets →
    // AI_PERSONALITY) so this marketing chat follows the same brand voice/rules
    // as the rest of the bot instead of a fixed, baked-in CMO persona.
    const systemInstruction = await withOperatorPersona(
      MARKETING_MANAGER_SYSTEM_PROMPT(config, dynamicKB),
    );
    const genAI = new GoogleGenerativeAI(validKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_DEFAULT_MODEL,
      systemInstruction,
    });

    const result = await model.generateContent(message);
    const response = result.response.text();

    res.json({ response });
  } catch (error: any) {
    console.error('Marketing Manager Error:', error);
    res.status(500).json({
      error: 'Failed to generate marketing response.',
      details: error.message,
    });
  }
});

export default router;
