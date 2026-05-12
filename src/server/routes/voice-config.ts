import { Router, Request, Response } from 'express';
import VoiceConfig from '../../models/VoiceConfig';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// SECURITY FIX: All voice config routes require authentication
router.use(authenticateToken);

// GET all voice configs
router.get('/', async (req: Request, res: Response) => {
  try {
    const configs = await VoiceConfig.find().sort({ updatedAt: -1 });
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

// GET active config
router.get('/active', async (req: Request, res: Response) => {
  try {
    const activeConfig = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
    if (!activeConfig) {
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

// POST — save / activate a provider config
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      provider,
      apiKey,
      googleApiKey,
      voiceId,
      isActive,
      mode,
      ttsModel,
    } = req.body;

    // Activate this provider → deactivate all others
    if (isActive !== false) {
      await VoiceConfig.updateMany(
        { provider: { $ne: provider } },
        { $set: { isActive: false } },
      );
    }

    const config = await VoiceConfig.findOneAndUpdate(
      { provider },
      {
        provider,
        apiKey,
        googleApiKey,
        voiceId,
        isActive: isActive !== false,
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

// POST /toggle — enable/disable voice agent globally
router.post('/toggle', async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body;
    await VoiceConfig.updateMany({}, { $set: { isActive } });
    const configs = await VoiceConfig.find().sort({ updatedAt: -1 });
    res.json({ success: true, isActive, configs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle voice agent' });
  }
});

// POST /test — test TTS generation for a given provider
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { text, language, provider } = req.body;
    const { generateSpeech } = await import('../../services/voice');

    const testText =
      text ||
      (language === 'si'
        ? 'ආයුබෝවන්! ඔබේ ඇමතුම ගැන ස්තූතියි.'
        : language === 'ta'
        ? 'வணக்கம்! அழைத்ததற்கு நன்றி.'
        : 'Hello! Thank you for calling. How can I help you today?');

    const audioBuffer = await generateSpeech(testText, language || 'en');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tts-test-${language || 'en'}.mp3"`,
    );
    res.send(audioBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'TTS test failed' });
  }
});

export default router;
