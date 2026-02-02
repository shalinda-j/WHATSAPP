import express from 'express';
import { WhatsAppSessionManager } from '../../services/whatsapp';
import Session from '../../models/Session';

const router = express.Router();
const manager = WhatsAppSessionManager.instance;

// Get all sessions
router.get('/', async (req, res) => {
    try {
        const sessions = await Session.find().sort({ createdAt: -1 });
        const activeCount = manager.getActiveSessionsCount();
        res.json({
            sessions,
            activeCount,
            total: sessions.length
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

        // Create DB entry if not exists
        let session = await Session.findOne({ sessionId: newId });
        if (!session) {
            session = await Session.create({
                sessionId: newId,
                sessionName: newName,
                status: 'connecting'
            });
            console.log(`   ✅ Session DB entry created for: ${newId}`);
        } else {
            console.log(`   ⚠️ Session ${newId} already exists in DB. Reusing.`);
        }

        // Start the socket (this is async but we don't await it, it runs in background)
        manager.startSession(newId).catch((err: any) => {
            console.error(`   ❌ Error during startSession for ${newId}:`, err.message);
        });

        res.json({ message: 'Session started', sessionId: newId, sessionName: newName });
    } catch (error: any) {
        console.error('❌ Session creation error:', error);
        // Provide more detail to the frontend
        if (error.code === 11000) {
            res.status(409).json({ error: 'A session with this ID already exists.', code: 'DUPLICATE_SESSION' });
        } else {
            res.status(500).json({ error: error.message || 'Unknown error during session creation' });
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
