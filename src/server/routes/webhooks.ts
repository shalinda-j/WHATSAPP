import express from 'express';
import Webhook from '../../models/Webhook';
import { sendMessage } from '../../services/whatsapp';

const router = express.Router();

// --- INBOUND ---

// Handle Inbound Webhook (External System -> Bot)
router.post('/inbound', async (req, res) => {
    try {
        const { event, payload, secret, sessionId } = req.body;

        console.log(`🪝 Inbound webhook received: ${event}`);

        // Basic Secret Validation (Optional but recommended)
        // Real implementation should verify signature if high security needed
        // For now, we assume simple secret token match if provided
        if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
            return res.status(401).json({ error: 'Invalid secret' });
        }

        if (event === 'send_message') {
            const { to, message } = payload;
            if (!to || !message) {
                return res
                    .status(400)
                    .json({ error: 'Missing "to" or "message" in payload' });
            }

            const sent = await sendMessage(to, message, sessionId || 'default');
            if (sent) {
                return res.json({ success: true, message: 'Message queued' });
            } else {
                return res.status(500).json({ error: 'Failed to send message' });
            }
        }

        res.json({ success: true, message: 'Event received' });
    } catch (error: any) {
        console.error('Inbound webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- CRUD for Admin Panel ---

// Get all webhooks
router.get('/', async (req, res) => {
    try {
        const webhooks = await (Webhook as any).find().sort({ createdAt: -1 });
        res.json(webhooks);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create new webhook
router.post('/', async (req, res) => {
    try {
        const webhook = new (Webhook as any)(req.body);
        await webhook.save();
        res.status(201).json(webhook);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Update webhook
router.put('/:id', async (req, res) => {
    try {
        const webhook = await (Webhook as any).findByIdAndUpdate(req.params.id, req.body, {
            new: true,
        });
        if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
        res.json(webhook);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete webhook
router.delete('/:id', async (req, res) => {
    try {
        const webhook = await (Webhook as any).findByIdAndDelete(req.params.id);
        if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
        res.json({ message: 'Webhook deleted' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
