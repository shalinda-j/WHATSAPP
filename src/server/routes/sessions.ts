import express from 'express';
import { WhatsAppSessionManager } from '../../services/whatsapp';
import Session from '../../models/Session';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';

const router = express.Router();
const manager = WhatsAppSessionManager.instance;

// SECURITY FIX: All session routes require authentication + tenant context.
router.use(authenticateToken);
router.use(resolveTenant);

// Get all sessions
router.get('/', async (req, res) => {
  try {
    // Only return non-deleted sessions
    const sessions = await Session.find({ deleted: { $ne: true } }).sort({
      createdAt: -1,
    });
    const activeCount = manager.getActiveSessionsCount();
    res.json({
      sessions,
      activeCount,
      total: sessions.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create/Start a new session
router.post('/', async (req, res) => {
  try {
    const { sessionId, sessionName } = req.body;

    // If no ID provided, generate one
    const newId = sessionId || `session_${Date.now()}`;
    const newName = sessionName || `Device ${newId.split('_')[1] || '1'}`;

    console.log(`📲 API: Creating new session: ${newId} (${newName})`);

    // If this session was previously deleted, allow it to restart
    if (manager.isSessionDeleted(newId)) {
      console.log(
        `   🔄 Session ${newId} was previously deleted (in-memory). Allowing restart...`,
      );
      manager.allowSessionRestart(newId);
    }

    // Create DB entry if not exists, or update if it was deleted
    let session = await Session.findOne({ sessionId: newId });
    if (!session) {
      session = await Session.create({
        sessionId: newId,
        // Stamp the owning tenant (finding #66) so sessions are
        // tenant-attributable; sessionId remains globally unique for now.
        tenantId: req.tenant?._id,
        sessionName: newName,
        status: 'connecting',
        deleted: false,
      });
      console.log(`   ✅ Session DB entry created for: ${newId}`);
    } else if (session.deleted) {
      // Session exists but was deleted - clear the deleted flag
      session = await Session.findOneAndUpdate(
        { sessionId: newId },
        { deleted: false, status: 'connecting', qr: null },
        { new: true },
      );
      console.log(`   ✅ Session ${newId} restored from deleted state.`);
      // Also clear from in-memory deleted set
      manager.allowSessionRestart(newId);
    } else {
      console.log(`   ⚠️ Session ${newId} already exists in DB. Reusing.`);
    }

    // Start the socket (this is async but we don't await it, it runs in background)
    // The manager already has checks to prevent duplicate starts, but we can log it here too
    manager.startSession(newId).catch((err: any) => {
      console.error(
        `   ❌ Error during startSession for ${newId}:`,
        err.message,
      );
    });

    res.json({
      message: 'Session started',
      sessionId: newId,
      sessionName: newName,
    });
  } catch (error: any) {
    console.error('❌ Session creation error:', error);
    // Provide more detail to the frontend
    if (error.code === 11000) {
      res.status(409).json({
        error: 'A session with this ID already exists.',
        code: 'DUPLICATE_SESSION',
      });
    } else {
      res.status(500).json({
        error: error.message || 'Unknown error during session creation',
      });
    }
  }
});

// Get specific session status
router.get('/:id', async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update session name
router.put('/:id/name', async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionName } = req.body;

    if (!sessionName) {
      return res.status(400).json({ error: 'Session name is required' });
    }

    const session = await Session.findOneAndUpdate(
      { sessionId: id },
      { sessionName },
      { new: true },
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Logout/Delete session
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await manager.deleteSession(id);
    res.json({ message: 'Session deleted and disconnected' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
