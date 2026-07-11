import { Router } from 'express';
import {
  getConnectionStatus,
  connectToWhatsApp,
} from '../../services/whatsapp';
import { authenticateToken } from '../middleware/auth';
import { isAiPaused, setAiPaused } from '../../services/aiPause';

const router = Router();

// Public status (read-only) - maybe limit who can see QR?
// For now, let's keep it somewhat open or use a separate endpoint for Public Status vs Admin Control
// Admin Panel needs it.

router.get('/status', async (req, res) => {
  try {
    const status = await getConnectionStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin only actions
router.use(authenticateToken);

// AI kill-switch: pause/resume the bot's automated replies without
// disconnecting the device (e.g. to break a reply loop). Global, instant.
router.get('/ai-pause', (_req, res) => res.json({ paused: isAiPaused() }));
router.post('/ai-pause', async (req, res) => {
  const paused = await setAiPaused(Boolean(req.body?.paused));
  res.json({ paused });
});

router.post('/reconnect', async (req, res) => {
  try {
    await connectToWhatsApp();
    res.json({ message: 'Reconnection initiated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
