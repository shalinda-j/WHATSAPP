import express from 'express';
import * as SystemController from '../controllers/SystemController';
import { authenticateToken } from '../middleware/auth';

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
router.post('/reset', SystemController.resetSystem);

export default router;
