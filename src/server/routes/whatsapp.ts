import { Router } from 'express';
import { getConnectionStatus, connectToWhatsApp } from '../../services/whatsapp';
import { authenticateToken } from '../middleware/auth';

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

router.post('/reconnect', async (req, res) => {
    try {
        await connectToWhatsApp();
        res.json({ message: 'Reconnection initiated' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
