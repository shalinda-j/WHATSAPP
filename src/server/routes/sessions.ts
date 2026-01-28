import express from 'express';
import { WhatsAppSessionManager } from '../../services/whatsapp';
import Session from '../../models/Session';

const router = express.Router();
const manager = WhatsAppSessionManager.instance;

// Get all sessions
router.get('/', async (req, res) => {
    try {
        const sessions = await Session.find().sort({ createdAt: -1 });
        res.json(sessions);
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

        // Create DB entry if not exists
        let session = await Session.findOne({ sessionId: newId });
        if (!session) {
            session = await Session.create({
                sessionId: newId,
                sessionName: sessionName || `Device ${newId.split('_')[1] || '1'}`,
                status: 'connecting'
            });
        }

        // Start the socket
        manager.startSession(newId);

        res.json({ message: 'Session started', sessionId: newId });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
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
