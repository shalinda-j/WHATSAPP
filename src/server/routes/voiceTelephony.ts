/**
 * Voice telephony provider management endpoints. Mounted under
 * /api/voice-telephony. The actual outbound-call wiring is provider-
 * specific and lives in IVoiceTelephonyProvider implementations; this
 * router handles discovery + a thin outbound-call kicker.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { asyncHandler } from '../middleware/asyncHandler';
import { voiceTelephonyRegistry } from '../../services/voiceTelephony/providers';
import CallLog from '../../models/CallLog';

const router = Router();
router.use(authenticateToken);
router.use(resolveTenant);

router.get('/providers', (_req: Request, res: Response) => {
  res.json({
    providers: voiceTelephonyRegistry.list(),
    pinnedEnv: process.env.VOICE_TELEPHONY_PROVIDER ?? null,
  });
});

const InitiateCallSchema = z.object({
  to: z.string().min(3).max(80),
  from: z.string().min(3).max(80).optional(),
  provider: z.string().max(40).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

router.post(
  '/calls/initiate',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });

    const parsed = InitiateCallSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const provider = voiceTelephonyRegistry.pickReady(parsed.data.provider);
    if (!provider) {
      return res.status(503).json({
        error: 'no_provider_ready',
        providers: voiceTelephonyRegistry.list(),
        hint: 'Set credentials for one of the listed providers (Twilio is the fastest path) and try again.',
      });
    }

    if (!provider.supportsOutbound) {
      return res.status(400).json({
        error: 'provider_does_not_support_outbound',
        provider: provider.name,
      });
    }

    try {
      const result = await provider.initiateCall({
        to: parsed.data.to,
        from: parsed.data.from,
        metadata: parsed.data.metadata,
      });
      const log = await CallLog.create({
        sessionId: 'voice-telephony',
        callerId: parsed.data.from ?? 'system',
        callerPhone: parsed.data.to,
        startTime: new Date(),
        status: result.status === 'answered' ? 'answered' : 'missed',
        direction: 'outgoing',
      });
      res.status(201).json({
        success: true,
        providerCallId: result.providerCallId,
        status: result.status,
        logId: log._id,
      });
    } catch (err) {
      res.status(502).json({
        error: 'provider_call_failed',
        detail: err instanceof Error ? err.message : 'unknown',
        provider: provider.name,
      });
    }
  }),
);

export default router;
