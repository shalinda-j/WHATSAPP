import { Router } from 'express';
import { voiceCallAgent } from '../../services/VoiceCallAgentService';
import CallLog from '../../models/CallLog';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { generateSpeech } from '../../services/voice';
import { liveCallSettings } from '../../services/LiveCallSettingsService';
import { synthesizeCallSpeech } from '../../services/LiveCallService';
import type {
  LiveCallMode,
  CallTtsModel,
} from '../../services/LiveCallService';

const router = Router();

const VALID_MODES: LiveCallMode[] = ['reject-reply', 'live-answer'];
const VALID_TTS: CallTtsModel[] = [
  'auto',
  'gemini',
  'openai',
  'elevenlabs',
  'google',
];

// All routes protected + tenant-scoped
router.use(authenticateToken);
router.use(resolveTenant);

function tenantScope(req: {
  tenant?: { _id?: unknown };
}): Record<string, unknown> {
  const tenantId = req.tenant?._id ? String(req.tenant._id) : null;
  return tenantId
    ? { $or: [{ tenantId }, { tenantId: { $exists: false } }] }
    : {};
}

// GET /api/call-agent/logs
router.get('/logs', async (req, res) => {
  try {
    const {
      sessionId,
      limit = '50',
      page = '1',
    } = req.query as Record<string, string>;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    // Combine session filter (if any) with tenant scope. Two clauses each
    // can carry an $or, so chain via $and to keep them independent.
    const scope = tenantScope(req as { tenant?: { _id?: unknown } });
    const sessionClause = sessionId ? { sessionId } : null;
    const subClauses = [scope, sessionClause].filter(
      (c): c is Record<string, unknown> => !!c && Object.keys(c).length > 0,
    );
    const query =
      subClauses.length === 0
        ? {}
        : subClauses.length === 1
          ? subClauses[0]
          : { $and: subClauses };
    const [logs, total] = await Promise.all([
      CallLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
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
    res.status(500).json({
      error: 'Failed to fetch settings',
      enabled: false,
      language: 'en',
      greeting: '',
      personality: '',
    });
  }
});

// POST /api/call-agent/settings (save all settings at once)
router.post('/settings', async (req, res) => {
  try {
    const { enabled, language, greeting, personality } = req.body;
    await voiceCallAgent.enableCallAgent(!!enabled);
    if (language) voiceCallAgent.setPrimaryLanguage(language);
    if (greeting !== undefined)
      voiceCallAgent.setCallGreeting(language || 'en', greeting);
    if (personality !== undefined)
      voiceCallAgent.setAgentPersonality(personality);
    const settings = voiceCallAgent.getSettings();
    res.json({
      success: true,
      enabled: !!enabled,
      language: settings.language,
      greeting: settings.greeting,
      personality: settings.personality,
    });
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
    // Tenant-scope the delete so a tenant admin can't remove another
    // tenant's call log by id (GET /logs is already scoped the same way).
    const scope = tenantScope(req as { tenant?: { _id?: unknown } });
    const filter =
      Object.keys(scope).length > 0
        ? { $and: [{ _id: req.params.id }, scope] }
        : { _id: req.params.id };
    const deleted = await CallLog.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ error: 'Call log not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete log' });
  }
});

// POST /api/call-agent/test-voice
// Generates a TTS voice reply using the active provider (Gemini TTS preferred) and returns base64 WAV
router.post('/test-voice', async (req, res) => {
  try {
    const { language = 'en', text } = req.body as {
      language?: string;
      text?: string;
    };

    const defaultGreetings: Record<string, string> = {
      en: "Hello! Thank you for calling. I'm your AI voice assistant. How can I help you today?",
      si: 'ආයුබෝවන්! ඔබේ ඇමතුම ගැන ස්තූතියි. මම ඔබේ AI සහකාරයෙකි.',
      ta: 'வணக்கம்! அழைத்ததற்கு நன்றி. நான் உங்கள் AI உதவியாளர்.',
    };

    const greetingText =
      text?.trim() || defaultGreetings[language] || defaultGreetings.en;

    console.log(
      `🔊 Test voice TTS requested: lang=${language}, text="${greetingText.slice(
        0,
        60,
      )}..."`,
    );

    const audioBuffer = await generateSpeech(
      greetingText,
      language as 'en' | 'si' | 'ta',
    );

    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(500).json({
        error:
          'TTS generation failed — audio buffer empty. Check your Gemini API key.',
      });
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

// ──────────────────────────────────────────────────────────────────────────
// Live Call settings (WhatsApp Business Calling API + TTS model) — fully
// managed from the Admin Panel. Secrets are never returned raw; the client
// sees hasApiToken / hasAppSecret booleans and re-submits a value only to
// change it.
// ──────────────────────────────────────────────────────────────────────────

// GET /api/call-agent/live-settings
router.get('/live-settings', async (_req, res) => {
  try {
    const settings = await liveCallSettings.getPublic();
    res.json({
      settings,
      options: { modes: VALID_MODES, ttsModels: VALID_TTS },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load live call settings' });
  }
});

// POST /api/call-agent/live-settings
router.post('/live-settings', async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.mode === 'string') {
      if (!VALID_MODES.includes(body.mode as LiveCallMode)) {
        return res.status(400).json({ error: 'invalid mode' });
      }
      patch.mode = body.mode;
    }
    if (typeof body.ttsModel === 'string') {
      if (!VALID_TTS.includes(body.ttsModel as CallTtsModel)) {
        return res.status(400).json({ error: 'invalid ttsModel' });
      }
      patch.ttsModel = body.ttsModel;
    }
    for (const f of [
      'liveGreeting',
      'defaultLanguage',
      'phoneNumberId',
      'webhookVerifyToken',
      'graphVersion',
      'apiToken',
      'appSecret',
    ]) {
      if (typeof body[f] === 'string') patch[f] = body[f];
    }

    await liveCallSettings.update(patch);
    const settings = await liveCallSettings.getPublic();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save live call settings' });
  }
});

// GET /api/call-agent/live-status — readiness diagnostics for the panel.
router.get('/live-status', async (_req, res) => {
  try {
    const s = await liveCallSettings.load();
    const callingConfigured = await liveCallSettings.isCallingConfigured();

    // Probe the optional WebRTC media stack without importing it eagerly.
    let mediaAvailable = false;
    try {
      const { MediaBridge } =
        await import('../../services/whatsappCalling/MediaBridge');
      mediaAvailable = await MediaBridge.isAvailable();
    } catch {
      mediaAvailable = false;
    }

    const liveAnswerReady =
      s.mode === 'live-answer' && callingConfigured && mediaAvailable;

    res.json({
      mode: s.mode,
      ttsModel: s.ttsModel,
      callingConfigured,
      mediaAvailable,
      liveAnswerReady,
      // Human-readable reason when live answer can't run, for the panel banner.
      reason: liveAnswerReady
        ? null
        : s.mode !== 'live-answer'
          ? 'Mode is reject-reply (calls are declined with a smart voice/text reply).'
          : !callingConfigured
            ? 'WhatsApp Business Calling API credentials are not configured.'
            : 'WebRTC media library (werift) is not installed on the server.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load live status' });
  }
});

// POST /api/call-agent/test-call-tts — synthesize using the configured CALL
// TTS model specifically (not the global voice config), returns base64 WAV.
router.post('/test-call-tts', async (req, res) => {
  try {
    const { language, text } = req.body as {
      language?: string;
      text?: string;
    };
    const s = await liveCallSettings.load();
    const lang = language || s.defaultLanguage || 'si';
    const sample =
      text?.trim() || s.liveGreeting || 'ආයුබෝවන්! මෙය ඇමතුම් හඬ පරීක්ෂණයකි.';

    const audio = await synthesizeCallSpeech(sample, lang, s.ttsModel);
    if (!audio || audio.length < 100) {
      return res
        .status(500)
        .json({ error: 'TTS generation failed — empty audio buffer' });
    }
    res.json({
      success: true,
      audio: audio.toString('base64'),
      format: 'wav',
      size: audio.length,
      ttsModel: s.ttsModel,
      text: sample,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'TTS generation failed' });
  }
});

export default router;
