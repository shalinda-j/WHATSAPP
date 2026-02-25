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
                mode: 'voice-and-text'
            });
            return res.json([defaultConfig]);
        }

        res.json(configs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch voice config' });
    }
});

// UPDATE configuration
router.post('/', async (req: Request, res: Response) => {
    try {
        const { provider, apiKey, voiceId, isActive, mode, ttsModel } = req.body;

        // Upsert the configuration per provider type
        const config = await VoiceConfig.findOneAndUpdate(
            { provider },
            {
                provider,
                apiKey,
                voiceId,
                isActive,
                mode,
                ttsModel,
                updatedAt: new Date()
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update voice config' });
    }
});

export default router;
