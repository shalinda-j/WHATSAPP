import express from 'express';
import { configurationManager } from '../../services/ConfigurationManagerService';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// GET all configurations
router.get('/', authenticateToken, async (req, res) => {
  try {
    const config = await configurationManager.getAllConfiguration();
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('Error fetching configurations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching configurations',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET specific configuration by key
router.get('/:key', authenticateToken, async (req, res) => {
  const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;

  try {
    let result;

    switch (key.toLowerCase()) {
      case 'humanizer':
        result = await configurationManager.getHumanizerConfig();
        break;
      case 'company':
        result = await configurationManager.getCompanyInfo();
        break;
      case 'booking':
        result = await configurationManager.getBookingConfig();
        break;
      case 'jobs':
        result = await configurationManager.getJobTypes();
        break;
      case 'bookingkeywords':
        result = await configurationManager.getBookingKeywords();
        break;
      case 'conversations':
        result = await configurationManager.getConversationExamples();
        break;
      case 'aipersonality':
        result = await configurationManager.getAIPersonality();
        break;
      case 'knowledgebase':
        result = await configurationManager.getAIKnowledgeBase();
        break;
      default:
        return res.status(404).json({
          success: false,
          message: 'Configuration key not found'
        });
    }

    res.json({
      success: true,
      key,
      data: result
    });
  } catch (error) {
    console.error(`Error fetching configuration for ${key}:`, error);
    res.status(500).json({
      success: false,
      message: `Error fetching configuration for ${key}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// UPDATE specific configuration
router.put('/:key', authenticateToken, express.json(), async (req, res) => {
  const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
  const { content } = req.body;

  if (content === undefined) {
    return res.status(400).json({
      success: false,
      message: 'Content is required in request body'
    });
  }

  try {
    const success = await configurationManager.updateConfiguration(key, content);

    if (success) {
      // Clear cache after update
      configurationManager.clearCache();

      res.json({
        success: true,
        message: `Configuration ${key} updated successfully`
      });
    } else {
      res.status(500).json({
        success: false,
        message: `Failed to update configuration ${key}`
      });
    }
  } catch (error) {
    console.error(`Error updating configuration for ${key}:`, error);
    res.status(500).json({
      success: false,
      message: `Error updating configuration for ${key}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// CLEAR configuration cache
router.post('/cache/clear', authenticateToken, async (req, res) => {
  try {
    configurationManager.clearCache();
    res.json({
      success: true,
      message: 'Configuration cache cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing configuration cache:', error);
    res.status(500).json({
      success: false,
      message: 'Error clearing configuration cache',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;