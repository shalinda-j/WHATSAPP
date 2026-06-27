/**
 * Voice utility routes — mounted at /api/voice (behind authenticateToken in app.ts).
 *
 * POST /api/voice/stt
 *   multipart/form-data, single field "audio"
 *   → transcribeAudioWithLanguage(buffer, mimetype)
 *   → { text, detectedLanguage }
 */

import { Router } from 'express';
import multer from 'multer';
import { transcribeAudioWithLanguage } from '../../services/voice';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// POST /api/voice/stt — speech-to-text utility
router.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res
        .status(400)
        .json({ error: 'No audio file uploaded (field "audio")' });
    }

    const result = await transcribeAudioWithLanguage(
      req.file.buffer,
      req.file.mimetype,
    );

    return res.json({
      text: result.text,
      detectedLanguage: result.detectedLanguage,
    });
  } catch (err: any) {
    console.error('❌ /api/voice/stt failed:', err?.message || err);
    return res
      .status(500)
      .json({ error: err?.message || 'Transcription failed' });
  }
});

export default router;
