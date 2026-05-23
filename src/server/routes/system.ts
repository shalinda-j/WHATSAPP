import express from 'express';
import * as SystemController from '../controllers/SystemController';
import { authenticateToken } from '../middleware/auth';
import { strictRateLimit } from '../middleware/rateLimit';

const router = express.Router();

// SECURITY FIX: All system routes require authentication
router.use(authenticateToken);

// GET /api/system/stats
router.get('/stats', SystemController.getStats);

// POST /api/system/cache/clear
router.post('/cache/clear', SystemController.clearCache);

// GET /api/system/export
router.get('/export', SystemController.exportData);

// POST /api/system/reset
// Strict rate limit: brute-forcing the admin-password second factor must
// be slow even if the JWT is already compromised.
router.post('/reset', strictRateLimit, SystemController.resetSystem);

export default router;
