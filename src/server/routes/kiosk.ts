/**
 * PUBLIC kiosk router — mounted at /api/kiosk WITHOUT the admin authenticateToken.
 *
 * Flow:
 *   1. A known WhatsApp customer is issued a short-lived 4-digit code (admin
 *      route / KioskInviteService.issue) which is delivered over WhatsApp.
 *   2. At the in-branch kiosk the visitor types the code → POST /session
 *      redeems it and returns a SHORT-LIVED kiosk JWT (role:"kiosk", 30m).
 *   3. POST /consult (audio or text) continues the SAME WhatsApp thread:
 *      STT → Sinhala-forced AILoadBalancer reply (reuses the Dataset
 *      personality + KB + the customer's WhatsApp history because the kiosk
 *      userId IS the customer JID) → Gemini TTS → base64 audio.
 *      Conversion is AI-auto-detected: conservative + idempotent.
 *   4. POST /convert is the explicit operator/visitor fallback to mark the
 *      visit converted.
 *
 * SECURITY: /session is public (it only accepts a valid unredeemed code).
 * /consult and /convert require the kiosk JWT (verifyKioskToken). The kiosk
 * JWT is signed with the SAME ACTUAL_JWT_SECRET as the admin tokens but is
 * scoped by role:"kiosk" and expires in 30 minutes.
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';

import { ACTUAL_JWT_SECRET } from '../jwt-secret';
import { standardRateLimit } from '../middleware/rateLimit';
import { kioskInviteService } from '../../services/KioskInviteService';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import {
  transcribeAudioWithLanguage,
  generateSpeech,
} from '../../services/voice';
import { analyzeLeadIntent } from '../../services/gemini';

const router = Router();

// Audio uploads stay in memory — we pass the raw buffer straight to STT.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB is plenty for a kiosk utterance
});

// ── Kiosk JWT payload + request augmentation ────────────────────────────────
interface KioskTokenPayload {
  role: 'kiosk';
  inviteId: string;
  tenantId?: string;
  jid?: string;
}

interface KioskRequest extends Request {
  kiosk?: { inviteId: string; tenantId?: string; jid?: string };
}

// ── verifyKioskToken — gate /consult + /convert ─────────────────────────────
function verifyKioskToken(
  req: KioskRequest,
  res: Response,
  next: NextFunction,
): void {
  try {
    const headerToken =
      (req.headers['x-kiosk-token'] as string | undefined) || undefined;
    const auth = req.headers['authorization'] || '';
    const bearer =
      typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : undefined;
    const token = headerToken || bearer;

    if (!token) {
      res.status(401).json({ error: 'Missing kiosk token' });
      return;
    }

    const decoded = jwt.verify(token, ACTUAL_JWT_SECRET) as KioskTokenPayload;
    if (!decoded || decoded.role !== 'kiosk' || !decoded.inviteId) {
      res.status(401).json({ error: 'Invalid kiosk token' });
      return;
    }

    req.kiosk = {
      inviteId: decoded.inviteId,
      tenantId: decoded.tenantId,
      jid: decoded.jid,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired kiosk token' });
  }
}

// ── Conservative + idempotent conversion auto-detect ────────────────────────
// We ONLY treat a visit as converted when the user explicitly signals a clear
// enrollment/commitment intent. Asking a price or "tell me about courses" is
// NOT enough (those are Medium signals). Idempotency lives in
// KioskInviteService.markConverted — calling it again is always safe.
const COMMITMENT_PATTERNS: RegExp[] = [
  // English / Singlish explicit commitments
  /\b(i\s+want\s+to\s+)?(enroll|enrol|register|sign\s*up|join|admit|admission)\b/i,
  /\b(i'?ll|i\s+will|let'?s|lets)\s+(enroll|enrol|register|join|sign\s*up|go\s+ahead|do\s+it|proceed)\b/i,
  /\b(i\s+(am|'m)\s+ready\s+to\s+(enroll|register|join|pay|start))\b/i,
  /\b(i\s+(agree|confirm)\s+to\s+(pay|enroll|register|join))\b/i,
  /\b(sign\s+me\s+up|count\s+me\s+in|book\s+my\s+(seat|enrollment))\b/i,
  // Sinhala explicit commitments (ලියාපදිංචි / බැඳෙනවා / එකතු වෙනවා / ගෙවනවා)
  /ලියාපදිංචි\s*(වෙන්න|වෙනවා|කරන්න|වෙන්නම්)/,
  /(බැඳෙන්න|බැඳෙනවා|බැඳෙන්නම්)/,
  /(එකතු\s*වෙන්න|එකතු\s*වෙනවා|එකතු\s*වෙන්නම්)/,
  /(මම\s*එනවා|මම\s*එනවා\s*ලියාපදිංචි)/,
  /(ගෙවන්න\s*ලෑස්තියි|ගෙවනවා|ගෙවන්නම්)/,
];

/**
 * Returns true ONLY when the latest user text (or, secondarily, the assistant
 * reply confirming an enrollment) carries a clear, unambiguous commitment.
 * Conservative by design — false negatives are preferred over false positives.
 */
async function detectConversion(
  userText: string,
  reply: string,
): Promise<boolean> {
  const u = (userText || '').trim();
  if (!u) return false;

  // 1. Primary: explicit commitment phrasing in the USER's own words.
  const userCommits = COMMITMENT_PATTERNS.some((re) => re.test(u));
  if (userCommits) return true;

  // 2. Secondary, still conservative: the assistant explicitly confirms an
  //    enrollment AND analyzeLeadIntent rates the user a HIGH buying signal.
  //    Both must agree, so a stray confirmation phrase alone never converts.
  const replyConfirmsEnrollment =
    /\b(enroll|enrolled|enrollment|registered|registration|admission)\b/i.test(
      reply || '',
    ) || /(ලියාපදිංචි|ඇතුළත්\s*කර)/.test(reply || '');

  if (replyConfirmsEnrollment) {
    try {
      const intent = await analyzeLeadIntent(u);
      if (
        intent &&
        intent.buyingSignal === 'High' &&
        // require the user to be committing, not merely price-shopping
        /\b(yes|ok|okay|sure|done|confirm|agreed?)\b/i.test(u)
      ) {
        return true;
      }
    } catch {
      /* analyzer is best-effort — fall through to "not converted" */
    }
  }

  return false;
}

// ── Magic-byte audio container detection ────────────────────────────────────
function detectAudioMime(buf: Buffer): string {
  if (!buf || buf.length < 3) return 'audio/mpeg';
  // RIFF....WAVE → WAV (Gemini TTS path returns WAV)
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    return 'audio/wav';
  }
  // "ID3" tag → MP3
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return 'audio/mpeg';
  }
  // MPEG audio frame sync 0xFF 0xFB / 0xF3 / 0xF2 → MP3 (Google-free path)
  if (buf[0] === 0xff && (buf[1] === 0xfb || buf[1] === 0xf3 || buf[1] === 0xf2)) {
    return 'audio/mpeg';
  }
  return 'audio/mpeg';
}

// ── Sinhala reply-instruction append (mirrors src/index.ts ~1394-1403) ───────
function appendSinhalaInstruction(userText: string): string {
  const hasSinhala = /[඀-෿]/.test(userText);
  const hasTamil = /[஀-௿]/.test(userText);
  if (hasTamil) {
    return `${userText}\n\n(SYSTEM: தமிழ் மொழியில் பதிலளிக்கவும்.)`;
  }
  if (hasSinhala) {
    return `${userText}\n\n(SYSTEM: සිංහල භාෂාවෙන් ප්‍රතිඋත්තර දෙන්න.)`;
  }
  // Singlish / names / numbers — default to Sinhala, mirror Singlish if used.
  return `${userText}\n\n(SYSTEM: පරිශීලකයා Singlish (සිංහල + ඉංග්‍රීසි අකුරු) හෝ සිංහල භාවිතා කරයි. සිංහල භාෂාවෙන් කෙටිව, ස්වාභාවිකව ප්‍රතිඋත්තර දෙන්න. පරිශීලකයා Singlish ලිවුවොත් එම ශෛලියට ගැලපීමට Singlish භාවිතා කරන්න. ඉංග්‍රීසි පමණක් භාවිතා නොකරන්න.)`;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /session — redeem a 4-digit code → short-lived kiosk JWT
// Body: { code }
// 200: { token, name, branch, greeting }
// 404: { error }
// ═══════════════════════════════════════════════════════════════════════════
router.post('/session', async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    if (!code) {
      res.status(404).json({ error: 'Invalid or expired code' });
      return;
    }

    const result = await kioskInviteService.redeem(code);
    if (!result) {
      res.status(404).json({ error: 'Invalid or expired code' });
      return;
    }

    const { invite, name } = result;
    const branch = invite?.branch || '';
    const tenantId = invite?.tenantId ? String(invite.tenantId) : undefined;

    const token = jwt.sign(
      {
        role: 'kiosk',
        inviteId: String(invite._id),
        tenantId,
        jid: invite?.jid,
      } as KioskTokenPayload,
      ACTUAL_JWT_SECRET,
      { expiresIn: '30m' },
    );

    const greeting = `ආයුබෝවන් ${name}! ${
      branch ? `${branch} ශාඛාවට ` : ''
    }සාදරයෙන් පිළිගනිමු. ඔබට අවශ්‍ය දේ කතා කරන්න හෝ ටයිප් කරන්න.`;

    res.json({ token, name, branch, greeting });
  } catch (err: any) {
    console.error('❌ /api/kiosk/session error:', err?.message || err);
    res.status(500).json({ error: 'Failed to start kiosk session' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /consult — audio (multipart "audio") OR JSON { text }
//   STT → Sinhala-forced AI reply → Gemini TTS → base64 + auto-convert
// 200: { transcript, reply, audioBase64, mime, converted }
// 500: { error }
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/consult',
  standardRateLimit,
  verifyKioskToken,
  upload.single('audio'),
  async (req: KioskRequest, res: Response) => {
    try {
      const kiosk = req.kiosk!; // verifyKioskToken guarantees this
      const jid = kiosk.jid || kiosk.inviteId; // jid is the continued-thread userId

      // ── 1. Resolve the user text (audio → STT, else body.text) ────────────
      let transcript = '';
      if (req.file?.buffer?.length) {
        try {
          const stt = await transcribeAudioWithLanguage(
            req.file.buffer,
            req.file.mimetype,
          );
          transcript = (stt?.text || '').trim();
        } catch (err: any) {
          console.warn('⚠️ /consult STT failed:', err?.message || err);
          transcript = '';
        }
      } else if (typeof req.body?.text === 'string') {
        transcript = req.body.text.trim();
      }

      if (!transcript) {
        res
          .status(400)
          .json({ error: 'No speech or text was provided' });
        return;
      }

      // ── 2. Sinhala-forced reply via the SAME thread (personality + KB) ────
      const modelInput = appendSinhalaInstruction(transcript);
      let reply = '';
      try {
        reply = await aiLoadBalancer.sendMessage(
          jid,
          modelInput,
          kiosk.tenantId,
        );
      } catch (err: any) {
        console.warn('⚠️ /consult AI reply failed:', err?.message || err);
        reply = '';
      }
      if (!reply || /no ai services are configured/i.test(reply)) {
        reply = 'සමාවන්න, මට මේ මොහොතේ පිළිතුරු දීමට නොහැකි විය. නැවත උත්සාහ කරන්න.';
      }

      // ── 3. Gemini TTS → base64 (+ magic-byte mime). Never fatal. ──────────
      let audioBase64 = '';
      let mime = 'audio/mpeg';
      try {
        const audio = await generateSpeech(reply, 'si', 'gemini-tts');
        if (audio && audio.length > 0) {
          mime = detectAudioMime(audio);
          audioBase64 = audio.toString('base64');
        }
      } catch (err: any) {
        console.warn('⚠️ /consult TTS failed:', err?.message || err);
      }

      // ── 4. Conservative + idempotent AI auto-convert ──────────────────────
      let converted = false;
      try {
        if (await detectConversion(transcript, reply)) {
          converted = await kioskInviteService.markConverted(kiosk.inviteId);
        }
      } catch (err: any) {
        console.warn('⚠️ /consult auto-convert failed:', err?.message || err);
      }

      res.json({ transcript, reply, audioBase64, mime, converted });
    } catch (err: any) {
      console.error('❌ /api/kiosk/consult error:', err?.message || err);
      res.status(500).json({ error: 'Consultation failed' });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /convert — explicit fallback to mark the visit converted (idempotent)
// 200: { converted: true }
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/convert',
  verifyKioskToken,
  async (req: KioskRequest, res: Response) => {
    try {
      await kioskInviteService.markConverted(req.kiosk!.inviteId);
      res.json({ converted: true });
    } catch (err: any) {
      console.error('❌ /api/kiosk/convert error:', err?.message || err);
      res.status(500).json({ error: 'Conversion failed' });
    }
  },
);

export default router;
