import { Router, Request, Response } from 'express';
import VoiceConfig from '../../models/VoiceConfig';

const router = Router();

// GET current configuration
router.get('/', async (req: Request, res: Response) => {
    try {
        // Only one config document should exist, or we get the latest
        let config = await VoiceConfig.findOne().sort({ updatedAt: -1 });

        if (!config) {
            // Create default if not exists
            config = await VoiceConfig.create({
                provider: 'google-free',
                isActive: true,
                mode: 'voice-and-text'
            });
        }

        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch voice config' });
    }
});

// UPDATE configuration
router.post('/', async (req: Request, res: Response) => {
    try {
        const { provider, apiKey, voiceId, isActive, mode } = req.body;

        // Upsert the configuration (we only keep one active config for simplicity)
        const config = await VoiceConfig.findOneAndUpdate(
            {},
            {
                provider,
                apiKey,
                voiceId,
                isActive,
                mode,
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
