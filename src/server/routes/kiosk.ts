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
import {
  aiLoadBalancer,
  PROVIDER_TYPE_TO_OVERRIDE,
} from '../../services/AILoadBalancer';
import {
  transcribeAudioWithLanguage,
  generateSpeech,
} from '../../services/voice';
import {
  analyzeLeadIntent,
  extractEnrollmentFields,
  EnrollmentExtract,
} from '../../services/gemini';
import { FormService } from '../../services/FormService';
import { WebhookService } from '../../services/WebhookService';
import { CRMService } from '../../services/CRMService';
import Config from '../../models/Config';
import FormTemplate from '../../models/FormTemplate';
import KioskInvite, { IKioskCollected } from '../../models/KioskInvite';

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

// ── Resolve the operator-configured kiosk provider override ──────────────────
// KIOSK_AI_PROVIDER stores a DB providerType (e.g. "google"/"openai"). We map it
// through PROVIDER_TYPE_TO_OVERRIDE to the class-name substring the load-balancer
// reorder matches (google -> "gemini"). Returns null when unset/unknown so the
// load balancer behaves exactly as today (normal cooldown ordering). Never
// throws — a misconfigured/absent Config row just yields no override.
async function resolveKioskProviderOverride(): Promise<string | null> {
  try {
    const cfg = await Config.findOne({ key: 'KIOSK_AI_PROVIDER' }).lean();
    const raw = String((cfg as any)?.value ?? '')
      .trim()
      .toLowerCase();
    if (!raw) return null;
    return PROVIDER_TYPE_TO_OVERRIDE[raw] || raw || null;
  } catch {
    return null;
  }
}

// ── collected-state helpers ─────────────────────────────────────────────────
// `completed` flips true only once every REQUIRED leaf is present AND payment
// is confirmed paid (payment.paid === true). Optional leaves (email/address/
// level/reference) never gate completion.
function computeCompleted(c?: IKioskCollected | null): boolean {
  const p = c?.personal || {};
  const co = c?.course || {};
  const pay = c?.payment || {};
  return !!(
    p.fullName &&
    p.mobile &&
    p.nic &&
    co.program &&
    pay.paid === true &&
    pay.amount &&
    pay.method
  );
}

// Deep-merge a partial extract onto the running collected state in JS (so we can
// recompute `completed` from the merged result). Only non-null / non-empty
// leaves overwrite — the extractor returns ONLY newly-mentioned fields, so a
// missing key never clobbers a previously-captured sibling.
function mergeCollected(
  base: IKioskCollected | undefined | null,
  extract: EnrollmentExtract | null,
): IKioskCollected {
  const out: IKioskCollected = {
    personal: { ...(base?.personal || {}) },
    course: { ...(base?.course || {}) },
    payment: { ...(base?.payment || {}) },
  };
  if (!extract || typeof extract !== 'object') return out;
  for (const sec of ['personal', 'course', 'payment'] as const) {
    const obj = (extract as any)[sec];
    if (!obj || typeof obj !== 'object') continue;
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      (out as any)[sec][k] = v;
    }
  }
  return out;
}

// Build dotted `$set` paths (e.g. "collected.personal.fullName") from ONLY the
// newly-mentioned extract leaves so a partial Mongo update deep-merges without
// disturbing untouched siblings.
function buildCollectedDottedSet(
  extract: EnrollmentExtract | null,
): Record<string, any> {
  const set: Record<string, any> = {};
  if (!extract || typeof extract !== 'object') return set;
  for (const sec of ['personal', 'course', 'payment'] as const) {
    const obj = (extract as any)[sec];
    if (!obj || typeof obj !== 'object') continue;
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      set[`collected.${sec}.${k}`] = v;
    }
  }
  return set;
}

// Map merged collected -> Contact update. fullName->name, mobile->phone, all
// other captured leaves -> customFields (Map<String>) via dotted paths so we
// merge rather than clobber existing customFields. Values stringified because
// the Contact.customFields schema is a Map of String.
function buildContactUpdate(c: IKioskCollected): Record<string, any> {
  const p = c.personal || {};
  const co = c.course || {};
  const pay = c.payment || {};
  const data: Record<string, any> = {};
  if (p.fullName) data.name = p.fullName;
  if (p.mobile) data.phone = p.mobile;
  if (p.nic) data['customFields.nic'] = String(p.nic);
  if (p.email) data['customFields.email'] = String(p.email);
  if (p.address) data['customFields.address'] = String(p.address);
  if (co.program) data['customFields.course'] = String(co.program);
  if (co.level) data['customFields.level'] = String(co.level);
  if (pay.paid !== undefined)
    data['customFields.paymentPaid'] = String(pay.paid);
  if (pay.amount) data['customFields.paymentAmount'] = String(pay.amount);
  if (pay.method) data['customFields.paymentMethod'] = String(pay.method);
  if (pay.reference)
    data['customFields.paymentReference'] = String(pay.reference);
  return data;
}

// Build the collected-state-aware Sinhala consult directive: the agent knows
// exactly what is captured + what is still missing, asks ONE missing required
// field at a time, repeats back each captured value to confirm, reads courses/
// fees ONLY from the dataset KB, and announces completion once personal+course+
// payment(paid) are confirmed.
function buildConsultModelInput(
  userText: string,
  collected: IKioskCollected,
): string {
  const p = collected.personal || {};
  const co = collected.course || {};
  const pay = collected.payment || {};
  const req: Array<[string, any]> = [
    ['සම්පූර්ණ නම (full name)', p.fullName],
    ['ජංගම දුරකථන අංකය (mobile)', p.mobile],
    ['ජා.හැ. අංකය (NIC)', p.nic],
    ['පාඨමාලාව (course/program)', co.program],
    ['ගෙවීම ගෙවා ඇත්ද (payment paid)', pay.paid === true ? 'ඔව්' : undefined],
    ['ගෙවූ මුදල (amount)', pay.amount],
    ['ගෙවීම් ක්‍රමය (method)', pay.method],
  ];
  const captured = req
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([label, v]) => `${label}=${v}`);
  const missing = req
    .filter(([, v]) => v === undefined || v === null || v === '')
    .map(([label]) => label);

  const stateBlock =
    `(SYSTEM ලියාපදිංචි උපදෙස්: ඔබ ශාඛාවේ ලියාපදිංචි සහයකයෙකි. ` +
    `මෙතෙක් තහවුරු වූ තොරතුරු: ${
      captured.length ? captured.join(', ') : 'කිසිවක් නැත'
    }. ` +
    `තවම අවශ්‍ය අනිවාර්ය තොරතුරු: ${
      missing.length ? missing.join(', ') : 'සියල්ල සම්පූර්ණයි'
    }. ` +
    `නීති: (1) එක් වරකට අවශ්‍ය ලැයිස්තුවේ පළමු අයිතමය පමණක් අසන්න — එක් ප්‍රශ්නයක් පමණයි. ` +
    `(2) පරිශීලකයා දෙන සෑම අගයක්ම නැවත කියවා "${'මෙය හරිද?'}" ලෙස තහවුරු කරගන්න. ` +
    `(3) පාඨමාලා, මට්ටම් සහ ගාස්තු පිළිබඳ විස්තර දැනුම් පදනමෙන් (dataset knowledge base) පමණක් ලබා දෙන්න — කිසිවක් මනක්කල්පිත නොකරන්න. ` +
    `(4) නම, ජංගම අංකය, NIC, පාඨමාලාව, සහ ගෙවීම (ගෙවා ඇත) යන සියල්ල තහවුරු වූ පසු ලියාපදිංචිය සම්පූර්ණ බව පැහැදිලිව දන්වා ගෙවීම තහවුරු කරන ලෙස ඉල්ලන්න.)`;

  return `${appendSinhalaInstruction(userText)}\n\n${stateBlock}`;
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
//   STT → collected-state-aware Sinhala AI reply (operator-selected provider)
//   → Gemini TTS → base64 → per-turn enrollment-field extraction (deep $set
//   merge into KioskInvite.collected + mirror to the CRM Contact) → conservative
//   payment-gated auto-convert.
// 200: { transcript, reply, audioBase64, mime, converted, collected, completed }
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
        // If audio WAS uploaded but we couldn't transcribe it (STT provider
        // failed / not configured), don't hand the push-to-talk visitor a bare
        // HTTP error — reply with a spoken Sinhala retry prompt so the kiosk
        // plays it back. The truly-empty case (no audio AND no text) still 400s.
        if (req.file?.buffer?.length) {
          const retry =
            'සමාවන්න, ඔබ කී දේ මට හරියට ඇසුණේ නැහැ. කරුණාකර නැවත කතා කරන්න.';
          let audioBase64: string | undefined;
          try {
            const buf = await generateSpeech(retry, 'si');
            audioBase64 = buf.toString('base64');
          } catch {
            // TTS unavailable too — return a text-only retry prompt.
          }
          res.status(200).json({
            transcript: '',
            reply: retry,
            audioBase64,
            mime: 'audio/mpeg',
            converted: false,
            collected: {},
            completed: false,
          });
          return;
        }
        res.status(400).json({ error: 'No speech or text was provided' });
        return;
      }

      // ── 2. Current collected state (informs the consult instruction) ──────
      // Every DB read here is wrapped so a transient Mongo hiccup never breaks
      // the consult turn — we simply fall back to an empty collected state.
      let invite: any = null;
      try {
        invite = await KioskInvite.findById(kiosk.inviteId).lean();
      } catch (err: any) {
        console.warn('⚠️ /consult invite load failed:', err?.message || err);
      }
      const currentCollected: IKioskCollected =
        (invite?.collected as IKioskCollected) || {};

      // ── 3. Collected-state-aware Sinhala reply via the SAME thread ────────
      // (personality + KB + history). Provider is the operator-configured
      // KIOSK_AI_PROVIDER mapped through PROVIDER_TYPE_TO_OVERRIDE (null = no
      // override → unchanged load-balancer behaviour).
      const modelInput = buildConsultModelInput(transcript, currentCollected);
      const providerOverride = await resolveKioskProviderOverride();
      let reply = '';
      try {
        reply = await aiLoadBalancer.sendMessage(
          jid,
          modelInput,
          kiosk.tenantId,
          providerOverride,
        );
      } catch (err: any) {
        console.warn('⚠️ /consult AI reply failed:', err?.message || err);
        reply = '';
      }
      if (!reply || /no ai services are configured/i.test(reply)) {
        reply = 'සමාවන්න, මට මේ මොහොතේ පිළිතුරු දීමට නොහැකි විය. නැවත උත්සාහ කරන්න.';
      }

      // ── 4. Gemini TTS → base64 (+ magic-byte mime). Never fatal. ──────────
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

      // ── 5. Per-turn enrollment-field extraction → deep $set-merge ─────────
      // Extract ONLY newly-mentioned fields from THIS utterance; a parse/timeout
      // failure returns null and is tolerated. Merge into KioskInvite.collected
      // (dotted $set so siblings survive), recompute `completed`, then mirror the
      // captured values onto the CRM Contact. Each step is independently wrapped.
      let collected: IKioskCollected = mergeCollected(currentCollected, null);
      let completed = computeCompleted(collected);
      try {
        const extract = await extractEnrollmentFields(transcript);
        if (extract) {
          collected = mergeCollected(currentCollected, extract);
          completed = computeCompleted(collected);
          const dotted = buildCollectedDottedSet(extract);
          if (Object.keys(dotted).length > 0) {
            try {
              const updated = await KioskInvite.findByIdAndUpdate(
                kiosk.inviteId,
                { $set: { ...dotted, completed } },
                { new: true },
              ).lean();
              if (updated) {
                invite = updated;
                collected =
                  (updated.collected as IKioskCollected) || collected;
                completed = computeCompleted(collected);
              }
            } catch (err: any) {
              console.warn(
                '⚠️ /consult collected $set failed:',
                err?.message || err,
              );
            }

            // Mirror onto the CRM Contact (best-effort, tenant-scoped).
            const contactId = invite?.contactId
              ? String(invite.contactId)
              : '';
            if (contactId) {
              const contactUpdate = buildContactUpdate(collected);
              if (Object.keys(contactUpdate).length > 0) {
                try {
                  await CRMService.updateContact(
                    contactId,
                    contactUpdate,
                    kiosk.tenantId,
                  );
                } catch (err: any) {
                  console.warn(
                    '⚠️ /consult CRM mirror failed:',
                    err?.message || err,
                  );
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.warn('⚠️ /consult extraction failed:', err?.message || err);
      }

      // ── 6. Payment-gated, idempotent auto-convert ─────────────────────────
      // Convert ONLY when every required field is captured AND payment is
      // confirmed paid (completed===true) AND the visitor signals a clear
      // commitment/confirmation this turn. markConverted is idempotent.
      let converted = invite?.status === 'converted';
      try {
        if (
          completed &&
          !converted &&
          (await detectConversion(transcript, reply))
        ) {
          converted = await kioskInviteService.markConverted(kiosk.inviteId);
        }
      } catch (err: any) {
        console.warn('⚠️ /consult auto-convert failed:', err?.message || err);
      }

      res.json({
        transcript,
        reply,
        audioBase64,
        mime,
        converted,
        collected,
        completed,
      });
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

// ═══════════════════════════════════════════════════════════════════════════
// POST /enroll — register the visitor against the "Enrollment Registration"
// FormTemplate: flatten KioskInvite.collected → form data, submit it, mark the
// invite converted (idempotent), then fire the "enrollment.registered" webhook
// so the operator's Main System (configured on the Webhooks page) is notified.
// 200: { registered: true, submissionId }
// 404: { error } (invite missing) | 400: { error } (template missing)
// 500: { error }
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/enroll',
  verifyKioskToken,
  async (req: KioskRequest, res: Response) => {
    try {
      const kiosk = req.kiosk!; // verifyKioskToken guarantees this

      // Resolve the invite (collected fields + phone/jid/branch come from here).
      let invite: any = null;
      try {
        invite = await KioskInvite.findById(kiosk.inviteId).lean();
      } catch (err: any) {
        console.warn('⚠️ /enroll invite load failed:', err?.message || err);
      }
      if (!invite) {
        res.status(404).json({ error: 'Kiosk invite not found' });
        return;
      }

      const tenantId =
        kiosk.tenantId ||
        (invite.tenantId ? String(invite.tenantId) : undefined);

      // Resolve the Enrollment Registration template BY NAME (tenant-scoped with
      // the legacy-null $or so default-tenant / unstamped rows still match).
      let template: any = null;
      try {
        const q: Record<string, any> = { name: 'Enrollment Registration' };
        if (tenantId) {
          q.$or = [
            { tenantId },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ];
        }
        template = await FormTemplate.findOne(q).lean();
      } catch (err: any) {
        console.warn('⚠️ /enroll template lookup failed:', err?.message || err);
      }
      if (!template) {
        res
          .status(400)
          .json({ error: 'Enrollment Registration template not found' });
        return;
      }
      const templateId = String(template._id);

      // Flatten collected → the template field keys.
      const c: IKioskCollected = (invite.collected as IKioskCollected) || {};
      const p = c.personal || {};
      const co = c.course || {};
      const pay = c.payment || {};
      const data: Record<string, any> = {
        fullName: p.fullName || '',
        mobile: p.mobile || '',
        nic: p.nic || '',
        email: p.email || '',
        address: p.address || '',
        course: co.program || '',
        level: co.level || '',
        paid: pay.paid === true,
        amount: pay.amount || '',
        method: pay.method || '',
        reference: pay.reference || '',
        branch: invite.branch || '',
      };

      const phone = invite.phone || p.mobile || '';
      const jid = invite.jid || kiosk.jid || '';

      // Submit the form (creates a FormSubmission; never throws — returns
      // { success:false } on error).
      let submissionId: string | undefined;
      try {
        const result = await FormService.submitForm(
          phone,
          templateId,
          data,
          jid,
        );
        submissionId = result?.submissionId;
      } catch (err: any) {
        console.warn('⚠️ /enroll submitForm failed:', err?.message || err);
      }

      // Mark the invite converted (idempotent — safe to call again).
      try {
        await kioskInviteService.markConverted(kiosk.inviteId);
      } catch (err: any) {
        console.warn('⚠️ /enroll markConverted failed:', err?.message || err);
      }

      // Notify the Main System via the configured webhook (events:["*"] or the
      // explicit "enrollment.registered" subscription). Fire-and-forget safe.
      try {
        await WebhookService.triggerWebhook(
          'enrollment.registered',
          {
            submissionId,
            ...data,
            jid,
            branch: invite.branch,
            tenantId,
            timestamp: new Date().toISOString(),
          },
          tenantId,
        );
      } catch (err: any) {
        console.warn('⚠️ /enroll webhook failed:', err?.message || err);
      }

      res.json({ registered: true, submissionId });
    } catch (err: any) {
      console.error('❌ /api/kiosk/enroll error:', err?.message || err);
      res.status(500).json({ error: 'Enrollment failed' });
    }
  },
);

export default router;
