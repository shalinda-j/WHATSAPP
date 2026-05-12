import { Router } from 'express';
import Config from '../../models/Config';
import Dataset from '../../models/Dataset';
import { authenticateToken } from '../middleware/auth';
import { HumanizerService } from '../../services/HumanizerService';
import {
  configService,
  HumanizerConfig,
  ConversationExample,
  CountryOption,
  ExperienceOption,
} from '../../services/ConfigService';
import { usageResetService } from '../../services/UsageResetService';
import { ChatGPTSessionService } from '../../services/ChatGPTSessionService';
import { ClaudeSessionService } from '../../services/ClaudeSessionService';
import { aiLoadBalancer } from '../../services/AILoadBalancer';

const router = Router();

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const configs = await Config.find();
    res.json(configs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    // Allow all body props to be saved
    const newConfig = new Config(req.body);
    await newConfig.save();
    res.json(newConfig);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updatedConfig = await Config.findByIdAndUpdate(
      req.params.id,
      { $set: req.body }, // Update whatever is in the body
      { new: true },
    );
    res.json(updatedConfig);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Config.findByIdAndDelete(req.params.id);
    res.json({ message: 'Config deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Humanizer Configuration Endpoints
// ============================================

/**
 * GET /api/config/humanizer
 * Get humanizer timing settings
 */
router.get('/humanizer', async (req, res) => {
  try {
    const config = await configService.getHumanizerConfig();
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/humanizer
 * Update humanizer timing settings
 */
router.put('/humanizer', async (req, res) => {
  try {
    const config = req.body as HumanizerConfig;

    // Find or create the dataset
    let dataset = await Dataset.findOne({ key: 'HUMANIZER_CONFIG' });

    if (dataset) {
      dataset.content = config;
      dataset.isActive = true;
      await dataset.save();
    } else {
      dataset = new Dataset({
        name: 'Humanizer Configuration',
        key: 'HUMANIZER_CONFIG',
        content: config,
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Timing parameters for message humanization',
      });
      await dataset.save();
    }

    // Clear cache to apply changes immediately
    HumanizerService.clearConfigCache();
    configService.clearCache();

    res.json({ success: true, config: dataset.content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Conversation Examples Endpoints
// ============================================

/**
 * GET /api/config/conversation-examples
 * Get AI training conversation examples
 */
router.get('/conversation-examples', async (req, res) => {
  try {
    const examples = await configService.getConversationExamples();
    res.json(examples);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/conversation-examples
 * Update AI training conversation examples
 */
router.put('/conversation-examples', async (req, res) => {
  try {
    const examples = req.body as ConversationExample[];

    // Validate it's an array
    if (!Array.isArray(examples)) {
      return res.status(400).json({ error: 'Examples must be an array' });
    }

    // Allow empty array to clear examples
    if (examples.length === 0) {
      const dataset = await Dataset.findOneAndUpdate(
        { key: 'CONVERSATION_EXAMPLES' },
        { content: { en: [] }, isActive: true, updatedAt: new Date() },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      configService.clearCache();
      return res.json({ success: true, examples: [] });
    }

    // Validate each example has user and assistant fields
    for (const ex of examples) {
      if (!ex.user || !ex.assistant) {
        return res
          .status(400)
          .json({ error: 'Each example must have user and assistant fields' });
      }
    }

    // Find or create the dataset - save in content.en format
    const dataset = await Dataset.findOneAndUpdate(
      { key: 'CONVERSATION_EXAMPLES' },
      {
        name: 'Conversation Examples',
        content: { en: examples }, // Store in multi-language format
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Training examples for AI conversation context',
        updatedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, examples: dataset.content?.en || examples });
  } catch (err: any) {
    console.error('Error saving conversation examples:', err);
    res.status(500).json({ error: err.message || 'Failed to save examples' });
  }
});

// ============================================
// Job Types Endpoints
// ============================================

/**
 * GET /api/config/job-types
 * Get job types for lead registration
 */
router.get('/job-types', async (req, res) => {
  try {
    const jobTypes = await configService.getJobTypes();
    res.json(jobTypes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/job-types
 * Update job types for lead registration
 */
router.put('/job-types', async (req, res) => {
  try {
    const jobTypes = req.body;

    // Validate it's an array
    if (!Array.isArray(jobTypes)) {
      return res
        .status(400)
        .json({ error: 'Job types must be an array of strings' });
    }

    // Find or create the dataset
    const dataset = await Dataset.findOneAndUpdate(
      { key: 'JOB_TYPES' },
      {
        name: 'Job Vacancy Types',
        content: { en: jobTypes },
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Available job types for lead registration',
        updatedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, jobTypes: dataset.content?.en || jobTypes });
  } catch (err: any) {
    console.error('Error saving job types:', err);
    res.status(500).json({ error: err.message || 'Failed to save job types' });
  }
});

// ============================================
// Booking Keywords Endpoints
// ============================================

/**
 * GET /api/config/booking-keywords
 * Get booking keywords for intent detection
 */
router.get('/booking-keywords', async (req, res) => {
  try {
    const keywords = await configService.getBookingKeywords();
    res.json(keywords);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/booking-keywords
 * Update booking keywords
 */
router.put('/booking-keywords', async (req, res) => {
  try {
    const keywords = req.body;

    // Validate it's an array
    if (!Array.isArray(keywords)) {
      return res
        .status(400)
        .json({ error: 'Keywords must be an array of strings' });
    }

    // Find or create the dataset
    const dataset = await Dataset.findOneAndUpdate(
      { key: 'BOOKING_KEYWORDS' },
      {
        name: 'Booking Keywords',
        content: { en: keywords },
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Keywords that trigger booking intent detection',
        updatedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, keywords: dataset.content?.en || keywords });
  } catch (err: any) {
    console.error('Error saving booking keywords:', err);
    res.status(500).json({ error: err.message || 'Failed to save keywords' });
  }
});

// ============================================
// Booking Configuration Endpoints
// ============================================

/**
 * GET /api/config/booking
 * Get booking configuration (location, organizer, etc.)
 */
router.get('/booking', async (req, res) => {
  try {
    const config = await configService.getBookingConfig();
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/booking
 * Update booking configuration
 */
router.put('/booking', async (req, res) => {
  try {
    const config = req.body;

    // Find or create the dataset
    let dataset = await Dataset.findOne({ key: 'BOOKING_CONFIG' });

    if (dataset) {
      dataset.content = config;
      dataset.isActive = true;
      await dataset.save();
    } else {
      dataset = new Dataset({
        name: 'Booking Configuration',
        key: 'BOOKING_CONFIG',
        content: config,
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Booking system configuration (location, organizer, etc.)',
      });
      await dataset.save();
    }

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, config: dataset.content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Company Info Endpoints
// ============================================

/**
 * GET /api/config/company-info
 * Get company information
 */
router.get('/company-info', async (req, res) => {
  try {
    const info = await configService.getCompanyInfo();
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/company-info
 * Update company information
 */
router.put('/company-info', async (req, res) => {
  try {
    const info = req.body;

    // Find or create the dataset
    let dataset = await Dataset.findOne({ key: 'COMPANY_INFO' });

    if (dataset) {
      dataset.content = info;
      dataset.isActive = true;
      await dataset.save();
    } else {
      dataset = new Dataset({
        name: 'Company Information',
        key: 'COMPANY_INFO',
        content: info,
        scope: 'ALL',
        category: 'info',
        isActive: true,
        description: 'General company contact details',
      });
      await dataset.save();
    }

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, info: dataset.content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Countries Endpoints (for Lead Registration)
// ============================================

/**
 * GET /api/config/countries
 * Get countries for job placement
 */
router.get('/countries', async (req, res) => {
  try {
    const countries = await configService.getCountries();
    res.json(countries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/countries
 * Update countries for job placement
 */
router.put('/countries', async (req, res) => {
  try {
    const countries = req.body as CountryOption[];

    // Validate it's an array
    if (!Array.isArray(countries)) {
      return res.status(400).json({ error: 'Countries must be an array' });
    }

    // Find or create the dataset
    const dataset = await Dataset.findOneAndUpdate(
      { key: 'COUNTRIES' },
      {
        name: 'Job Placement Countries',
        content: { en: countries },
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Countries available for job placement',
        updatedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, countries: dataset.content?.en || countries });
  } catch (err: any) {
    console.error('Error saving countries:', err);
    res.status(500).json({ error: err.message || 'Failed to save countries' });
  }
});

// ============================================
// Experience Levels Endpoints
// ============================================

/**
 * GET /api/config/experience-levels
 * Get experience levels for lead registration
 */
router.get('/experience-levels', async (req, res) => {
  try {
    const levels = await configService.getExperienceLevels();
    res.json(levels);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/experience-levels
 * Update experience levels
 */
router.put('/experience-levels', async (req, res) => {
  try {
    const levels = req.body as ExperienceOption[];

    // Validate it's an array
    if (!Array.isArray(levels)) {
      return res
        .status(400)
        .json({ error: 'Experience levels must be an array' });
    }

    // Find or create the dataset
    const dataset = await Dataset.findOneAndUpdate(
      { key: 'EXPERIENCE_LEVELS' },
      {
        name: 'Experience Levels',
        content: { en: levels },
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Experience level options for lead registration',
        updatedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, levels: dataset.content?.en || levels });
  } catch (err: any) {
    console.error('Error saving experience levels:', err);
    res.status(500).json({ error: err.message || 'Failed to save levels' });
  }
});

// ============================================
// Usage Cycle & Monthly Reset Endpoints
// ============================================

/**
 * GET /api/config/usage-cycle
 * Get current billing cycle information (dates, days remaining, etc.)
 */
router.get('/usage-cycle', async (req, res) => {
  try {
    const cycle = usageResetService.getCycleInfo();
    res.json({
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      nextReset: cycle.nextReset,
      daysRemaining: cycle.daysRemaining,
      daysElapsed: cycle.daysElapsed,
      totalDays: cycle.totalDays,
      progressPct: cycle.progressPct,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/config/reset-usage
 * Manually reset ALL AI provider usage counters for the current month
 */
router.post('/reset-usage', async (req, res) => {
  try {
    const result = await usageResetService.performReset('manual');
    res.json({
      success: true,
      resetCount: result.resetCount,
      resetAt: new Date(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/config/:id/reset-usage
 * Manually reset a single AI provider's usage counter
 */
router.post('/:id/reset-usage', async (req, res) => {
  try {
    const success = await usageResetService.resetProvider(req.params.id);
    if (!success) return res.status(404).json({ error: 'Provider not found' });
    res.json({ success: true, providerId: req.params.id, resetAt: new Date() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Unofficial Session-Based Providers (OpenAI / Claude)
// ============================================

/**
 * POST /api/config/session/test
 * Validate a pasted session cookie before saving.
 * Body: { providerType: 'openai-session' | 'claude-session', sessionToken: string }
 */
router.post('/session/test', async (req, res) => {
  const { providerType, sessionToken } = req.body || {};
  if (!providerType || !sessionToken) {
    return res
      .status(400)
      .json({ valid: false, error: 'providerType and sessionToken are required' });
  }

  try {
    if (providerType === 'openai-session') {
      const info = await ChatGPTSessionService.validateSession(sessionToken);
      return res.json({
        valid: true,
        info: { email: info.email, expires: info.expires },
      });
    }
    if (providerType === 'claude-session') {
      const info = await ClaudeSessionService.validateSession(sessionToken);
      return res.json({
        valid: true,
        info: {
          organizationId: info.organizationId,
          organizationName: info.organizationName,
          isPro: (info.capabilities || []).includes('claude_pro'),
        },
      });
    }
    return res
      .status(400)
      .json({ valid: false, error: `Unknown providerType: ${providerType}` });
  } catch (err: any) {
    return res.json({
      valid: false,
      error: err?.message || String(err),
      code: err?.code,
    });
  }
});

/**
 * POST /api/config/session/save
 * Validate + save (or update) a session-based provider in one call.
 * Body: { providerType, sessionToken, model?, isActive? }
 */
router.post('/session/save', async (req, res) => {
  const { providerType, sessionToken, model, isActive } = req.body || {};
  if (!providerType || !sessionToken) {
    return res
      .status(400)
      .json({ error: 'providerType and sessionToken are required' });
  }
  if (
    providerType !== 'openai-session' &&
    providerType !== 'claude-session'
  ) {
    return res.status(400).json({ error: 'Invalid providerType' });
  }

  try {
    let organizationId: string | undefined;
    let resolvedModel = model;

    if (providerType === 'openai-session') {
      await ChatGPTSessionService.validateSession(sessionToken);
      if (!resolvedModel) resolvedModel = 'text-davinci-002-render-sha';
    } else {
      const info = await ClaudeSessionService.validateSession(sessionToken);
      organizationId = info.organizationId;
      if (!resolvedModel) resolvedModel = 'claude-3-5-sonnet-20241022';
    }

    // Upsert: one session-based entry per provider type
    const existing = await Config.findOne({ isProvider: true, providerType });
    const payload: any = {
      isProvider: true,
      providerType,
      apiKey: sessionToken,
      aiModel: resolvedModel,
      isActive: isActive !== false,
      description:
        providerType === 'openai-session'
          ? 'Unofficial ChatGPT session (refresh cookie ~weekly)'
          : 'Unofficial Claude session (refresh cookie ~monthly)',
    };
    if (organizationId) payload.value = organizationId;

    let saved;
    if (existing) {
      saved = await Config.findByIdAndUpdate(
        (existing as any)._id,
        { $set: payload },
        { new: true },
      );
    } else {
      payload.key = `provider_${providerType}_${Date.now()}`;
      saved = await new Config(payload).save();
    }

    // Reload services so the new provider is picked up immediately
    await aiLoadBalancer.forceReloadServices();

    res.json({
      success: true,
      providerId: (saved as any)?._id,
      providerType,
      model: resolvedModel,
    });
  } catch (err: any) {
    res.status(400).json({
      error: err?.message || 'Failed to save session provider',
      code: err?.code,
    });
  }
});

export default router;
