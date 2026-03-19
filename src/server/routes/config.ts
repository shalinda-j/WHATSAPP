import { Router } from 'express';
import Config from '../../models/Config';
import Dataset from '../../models/Dataset';
import { authenticateToken } from '../middleware/auth';
import { HumanizerService } from '../../services/HumanizerService';
import { configService, HumanizerConfig, ConversationExample, CountryOption, ExperienceOption } from '../../services/ConfigService';

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

    // Validate each example has user and assistant fields
    for (const ex of examples) {
      if (!ex.user || !ex.assistant) {
        return res.status(400).json({ error: 'Each example must have user and assistant fields' });
      }
    }

    // Find or create the dataset
    let dataset = await Dataset.findOne({ key: 'CONVERSATION_EXAMPLES' });

    if (dataset) {
      dataset.content = examples;
      dataset.isActive = true;
      await dataset.save();
    } else {
      dataset = new Dataset({
        name: 'Conversation Examples',
        key: 'CONVERSATION_EXAMPLES',
        content: examples,
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Training examples for AI conversation context',
      });
      await dataset.save();
    }

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, examples: dataset.content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      return res.status(400).json({ error: 'Job types must be an array of strings' });
    }

    // Find or create the dataset
    let dataset = await Dataset.findOne({ key: 'JOB_TYPES' });

    if (dataset) {
      dataset.content = jobTypes;
      dataset.isActive = true;
      await dataset.save();
    } else {
      dataset = new Dataset({
        name: 'Job Vacancy Types',
        key: 'JOB_TYPES',
        content: jobTypes,
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Available job types for lead registration',
      });
      await dataset.save();
    }

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, jobTypes: dataset.content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      return res.status(400).json({ error: 'Keywords must be an array of strings' });
    }

    // Find or create the dataset
    let dataset = await Dataset.findOne({ key: 'BOOKING_KEYWORDS' });

    if (dataset) {
      dataset.content = keywords;
      dataset.isActive = true;
      await dataset.save();
    } else {
      dataset = new Dataset({
        name: 'Booking Keywords',
        key: 'BOOKING_KEYWORDS',
        content: keywords,
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Keywords that trigger booking intent detection',
      });
      await dataset.save();
    }

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, keywords: dataset.content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    let dataset = await Dataset.findOne({ key: 'COUNTRIES' });

    if (dataset) {
      dataset.content = countries;
      dataset.isActive = true;
      await dataset.save();
    } else {
      dataset = new Dataset({
        name: 'Job Placement Countries',
        key: 'COUNTRIES',
        content: countries,
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Countries available for job placement',
      });
      await dataset.save();
    }

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, countries: dataset.content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      return res.status(400).json({ error: 'Experience levels must be an array' });
    }

    // Find or create the dataset
    let dataset = await Dataset.findOne({ key: 'EXPERIENCE_LEVELS' });

    if (dataset) {
      dataset.content = levels;
      dataset.isActive = true;
      await dataset.save();
    } else {
      dataset = new Dataset({
        name: 'Experience Levels',
        key: 'EXPERIENCE_LEVELS',
        content: levels,
        scope: 'ALL',
        category: 'config',
        isActive: true,
        description: 'Experience level options for lead registration',
      });
      await dataset.save();
    }

    // Clear cache to apply changes immediately
    configService.clearCache();

    res.json({ success: true, levels: dataset.content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
