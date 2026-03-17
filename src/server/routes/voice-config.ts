import { Router, Request, Response } from 'express';
import VoiceConfig from '../../models/VoiceConfig';

const router = Router();

// GET all configurations
router.get('/', async (req: Request, res: Response) => {
  try {
    // Return all stored voice configs, sorted by latest updated
    const configs = await VoiceConfig.find().sort({ updatedAt: -1 });

    // If DB is completely empty, provide a default array structure
    if (!configs || configs.length === 0) {
      const defaultConfig = await VoiceConfig.create({
        provider: 'google-free',
        isActive: true,
        mode: 'voice-and-text',
      });
      return res.json([defaultConfig]);
    }

    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch voice config' });
  }
});

// GET active configuration
router.get('/active', async (req: Request, res: Response) => {
  try {
    // Find the currently active provider
    const activeConfig = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });

    if (!activeConfig) {
      // If no active config, return the most recently updated one
      const latestConfig = await VoiceConfig.findOne().sort({ updatedAt: -1 });
      return res.json(
        latestConfig || {
          provider: 'google-free',
          isActive: true,
          mode: 'voice-and-text',
        },
      );
    }

    res.json(activeConfig);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active voice config' });
  }
});

// UPDATE configuration (activates this provider and deactivates others)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, voiceId, isActive, mode, ttsModel } = req.body;

    // If activating this provider, deactivate all others first
    if (isActive !== false) {
      await VoiceConfig.updateMany(
        { provider: { $ne: provider } },
        { $set: { isActive: false } },
      );
    }

    // Upsert the configuration per provider type
    const config = await VoiceConfig.findOneAndUpdate(
      { provider },
      {
        provider,
        apiKey,
        voiceId,
        isActive: isActive !== false, // Default to true unless explicitly false
        mode,
        ttsModel,
        updatedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update voice config' });
  }
});

// Toggle voice agent on/off globally
router.post('/toggle', async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body;

    // Update all voice configs to the new isActive state
    await VoiceConfig.updateMany({}, { $set: { isActive } });

    // Return the updated state
    const configs = await VoiceConfig.find().sort({ updatedAt: -1 });
    res.json({ success: true, isActive, configs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle voice agent' });
  }
});

export default router;
