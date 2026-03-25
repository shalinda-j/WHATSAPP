import { Router } from 'express';
import { voiceCallAgent } from '../../services/VoiceCallAgentService';
import CallLog from '../../models/CallLog';
import { authenticateToken } from '../middleware/auth';
import { generateSpeech } from '../../services/voice';

const router = Router();

// All routes protected
router.use(authenticateToken);

// GET /api/call-agent/logs
router.get('/logs', async (req, res) => {
  try {
    const { sessionId, limit = '50', page = '1' } = req.query as Record<string, string>;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const query = sessionId ? { sessionId } : {};
    const [logs, total] = await Promise.all([
      CallLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      CallLog.countDocuments(query),
    ]);

    res.json({ logs, total, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch call logs' });
  }
});

// GET /api/call-agent/stats
router.get('/stats', async (req, res) => {
  try {
    const { sessionId } = req.query as { sessionId?: string };
    const stats = await voiceCallAgent.getCallStats(sessionId);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch call stats' });
  }
});

// GET /api/call-agent/settings (combined settings endpoint for frontend)
router.get('/settings', async (req, res) => {
  try {
    const enabled = await voiceCallAgent.isCallAgentEnabled();
    const settings = voiceCallAgent.getSettings();
    res.json({
      enabled,
      language: settings.language || 'en',
      greeting: settings.greeting || '',
      personality: settings.personality || '',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings', enabled: false, language: 'en', greeting: '', personality: '' });
  }
});

// POST /api/call-agent/settings (save all settings at once)
router.post('/settings', async (req, res) => {
  try {
    const { enabled, language, greeting, personality } = req.body;
    await voiceCallAgent.enableCallAgent(!!enabled);
    if (language) voiceCallAgent.setPrimaryLanguage(language);
    if (greeting !== undefined) voiceCallAgent.setCallGreeting(language || 'en', greeting);
    if (personality !== undefined) voiceCallAgent.setAgentPersonality(personality);
    const settings = voiceCallAgent.getSettings();
    res.json({ success: true, enabled: !!enabled, language: settings.language, greeting: settings.greeting, personality: settings.personality });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// GET /api/call-agent/status
router.get('/status', async (req, res) => {
  try {
    const enabled = await voiceCallAgent.isCallAgentEnabled();
    res.json({ enabled });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// POST /api/call-agent/toggle
router.post('/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    await voiceCallAgent.enableCallAgent(!!enabled);
    res.json({ success: true, enabled: !!enabled });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle call agent' });
  }
});

// POST /api/call-agent/greeting
router.post('/greeting', async (req, res) => {
  try {
    const { language, text } = req.body;
    if (!language || !text) {
      return res.status(400).json({ error: 'language and text required' });
    }
    voiceCallAgent.setCallGreeting(language, text);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update greeting' });
  }
});

// POST /api/call-agent/personality
router.post('/personality', async (req, res) => {
  try {
    const { personality } = req.body;
    voiceCallAgent.setAgentPersonality(personality || '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update personality' });
  }
});

// DELETE /api/call-agent/logs/:id
router.delete('/logs/:id', async (req, res) => {
  try {
    await CallLog.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete log' });
  }
});

// POST /api/call-agent/test-voice
// Generates a TTS voice reply using the active provider (Gemini TTS preferred) and returns base64 WAV
router.post('/test-voice', async (req, res) => {
  try {
    const { language = 'en', text } = req.body as { language?: string; text?: string };

    const defaultGreetings: Record<string, string> = {
      en: "Hello! Thank you for calling. I'm your AI voice assistant. How can I help you today?",
      si: "ආයුබෝවන්! ඔබේ ඇමතුම ගැන ස්තූතියි. මම ඔබේ AI සහකාරයෙකි.",
      ta: "வணக்கம்! அழைத்ததற்கு நன்றி. நான் உங்கள் AI உதவியாளர்.",
    };

    const greetingText = text?.trim() || defaultGreetings[language] || defaultGreetings.en;

    console.log(`🔊 Test voice TTS requested: lang=${language}, text="${greetingText.slice(0, 60)}..."`);

    const audioBuffer = await generateSpeech(greetingText, language as 'en' | 'si' | 'ta');

    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(500).json({ error: 'TTS generation failed — audio buffer empty. Check your Gemini API key.' });
    }

    res.json({
      success: true,
      audio: audioBuffer.toString('base64'),
      format: 'wav',
      size: audioBuffer.length,
      text: greetingText,
    });
  } catch (err: any) {
    console.error('❌ test-voice error:', err.message || err);
    res.status(500).json({ error: err.message || 'TTS generation failed' });
  }
});

export default router;
