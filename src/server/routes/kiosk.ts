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
import { standardRateLimit, rateLimit } from '../middleware/rateLimit';
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
import Lead from '../../models/Lead';
import ChatMessage from '../../models/ChatMessage';
import { Contact } from '../../models/CRM';

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
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46
  ) {
    return 'audio/wav';
  }
  // "ID3" tag → MP3
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return 'audio/mpeg';
  }
  // MPEG audio frame sync 0xFF 0xFB / 0xF3 / 0xF2 → MP3 (Google-free path)
  if (
    buf[0] === 0xff &&
    (buf[1] === 0xfb || buf[1] === 0xf3 || buf[1] === 0xf2)
  ) {
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
/**
 * Load the visitor's real journey so the consultant picks up EXACTLY where the
 * WhatsApp chat left off — their Lead profile (interests captured in the funnel)
 * plus the last few WhatsApp turns. Injected into the model input so the AI
 * "reviews what they need" instead of starting cold, and so the context is
 * present even if the load balancer's implicit history read misses (e.g. a
 * tenantId/JID shape mismatch between how WhatsApp stored it and how the kiosk
 * reads it). Every read is best-effort — any failure yields an empty string and
 * the consult still runs.
 */
async function buildCustomerContext(
  invite: any,
  jid: string,
  tenantId?: string,
): Promise<string> {
  // Resolve the visitor's real phone: invite.phone → linked Contact → JID digits.
  let phone = String(invite?.phone || '').replace(/\D/g, '');
  if (!phone && invite?.contactId) {
    const c: any = await Contact.findById(invite.contactId)
      .select('phone whatsappNumber')
      .lean()
      .catch(() => null);
    phone = String(c?.phone || c?.whatsappNumber || '').replace(/\D/g, '');
  }
  if (!phone) phone = String(jid || '').replace(/\D/g, '');
  // Match on the last 9 digits so +94 / 0-prefixed / bare-local all hit.
  const tail = phone.slice(-9);
  const parts: string[] = [];

  // 1. Lead profile — what they told us they want during the WhatsApp funnel.
  try {
    if (tail) {
      const base: Record<string, unknown> = {
        phoneNumber: { $regex: new RegExp(`${tail}$`) },
      };
      const filter = tenantId
        ? {
            ...base,
            $or: [
              { tenantId },
              { tenantId: { $exists: false } },
              { tenantId: null },
            ],
          }
        : base;
      const lead: any = await Lead.findOne(filter)
        .select(
          'fullName interestedCountry jobVacancyType experienceYears status',
        )
        .lean();
      if (lead) {
        const bits = [
          lead.fullName ? `නම ${lead.fullName}` : '',
          lead.interestedCountry ? `රට ${lead.interestedCountry}` : '',
          lead.jobVacancyType ? `රැකියාව/පාඨමාලාව ${lead.jobVacancyType}` : '',
          lead.experienceYears ? `පළපුරුද්ද ${lead.experienceYears}` : '',
        ].filter(Boolean);
        if (bits.length) parts.push(`Lead පැතිකඩ: ${bits.join(', ')}`);
      }
    }
  } catch {
    /* best-effort */
  }

  // 2. Recent WhatsApp turns — their own questions/interests before the visit.
  try {
    const orConds: any[] = [];
    // Only match the JID directly when it's a real WhatsApp JID (has '@') — an
    // admin-issued code carries no JID, so `jid` is the inviteId (matches none).
    if (jid && jid.includes('@')) orConds.push({ userId: jid });
    if (tail) {
      // userId is a JID (digits then @s.whatsapp.net/@lid) → anchor the tail
      // before '@'; metadata.realPhone is bare digits → anchor at the end. This
      // avoids a longer number matching the 9-digit tail as a mid-string substring.
      orConds.push({ userId: { $regex: new RegExp(`${tail}@`) } }); // phone-backed JIDs
      orConds.push({
        'metadata.realPhone': { $regex: new RegExp(`${tail}$`) },
      }); // @lid privacy JIDs
    }
    if (orConds.length === 0) return '';
    // Tenant-scope the lookup (legacy-tolerant) — same as the Lead query above.
    // Without it, two tenants whose customers share a phone tail would leak each
    // other's WhatsApp turns into the consultant prompt.
    const phoneOr = { $or: orConds };
    const msgFilter = tenantId
      ? {
          $and: [
            phoneOr,
            {
              $or: [
                { tenantId },
                { tenantId: { $exists: false } },
                { tenantId: null },
              ],
            },
          ],
        }
      : phoneOr;
    const msgs: any[] = await ChatMessage.find(msgFilter)
      .sort({ timestamp: -1 })
      .limit(10)
      .select('role content')
      .lean();
    if (msgs.length) {
      const lines = msgs
        .reverse()
        .map((m) => {
          const who = m.role === 'assistant' ? 'Bot' : 'Customer';
          const txt = String(m.content || '')
            .replace(/\s+/g, ' ')
            .slice(0, 160);
          return txt ? `${who}: ${txt}` : '';
        })
        .filter(Boolean);
      if (lines.length) {
        parts.push(`WhatsApp සංවාද ඉතිහාසය (recent):\n${lines.join('\n')}`);
      }
    }
  } catch {
    /* best-effort */
  }

  console.log(`🧠 kiosk context: phone=${tail || '-'} parts=${parts.length}`);
  if (parts.length === 0) return '';
  return (
    `(SYSTEM පාරිභෝගික පසුබිම — මෙම පුද්ගලයා දැනටමත් WhatsApp හරහා අප සමඟ කතා කර ඇත. ` +
    `පහත විස්තර හොඳින් කියවා, ඔවුන්ට අවශ්‍ය දේ තේරුම් ගෙන, ඒ අනුව පෞද්ගලීකෘතව උපදෙස් දෙන්න. ` +
    `නැවත මුල සිට සියල්ල අසන්න එපා — ඔවුන් දැනටමත් කී දේ මතක තබාගෙන ඉදිරියට යන්න.):\n` +
    parts.join('\n\n')
  );
}

function buildConsultModelInput(
  userText: string,
  collected: IKioskCollected,
  customerContext = '',
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
    `(SYSTEM: ඔබ ශාඛාවේ මිත්‍රශීලී මානව උපදේශකයෙක් — form එකක් පුරවන යන්ත්‍රයක් නොවේ. ` +
    `මෙය හඬ (voice) සංවාදයක්: සැබෑ මිනිසෙක් මෙන් උණුසුම්ව, ස්වාභාවිකව, කෙටියෙන් (වාක්‍ය 1–2ක්) කතා කරන්න. ` +
    `මෙතෙක් දැනගත් තොරතුරු: ${
      captured.length ? captured.join(', ') : 'කිසිවක් නැත'
    }. ` +
    `තවම දැනගන්න ඕන: ${
      missing.length ? missing.join(', ') : 'සියල්ල සම්පූර්ණයි'
    }. ` +
    `විලාසය: ` +
    `(1) පුද්ගලයාට අවශ්‍ය දේ ගැන ස්වාභාවික කතාබහක් කරන්න — ඔවුන්ගේ ඉලක්ක/ප්‍රශ්න ගැන කතා කර උදව් කරන්න. ` +
    `(2) අවශ්‍ය තොරතුරු එක එක ප්‍රශ්න විදිහට යාන්ත්‍රිකව අහන්න එපා — කතාව අතරතුර ස්වාභාවිකව, මෘදුව අහගන්න. හැම උත්තරයක්ම නැවත කියවා "මෙය හරිද?" කියා robot කෙනෙක් මෙන් තහවුරු කරන්න එපා; වැදගත් දේ (ගෙවීම වගේ) විතරක් සැහැල්ලුවෙන් තහවුරු කරගන්න. ` +
    `(3) පාඨමාලා/මට්ටම්/ගාස්තු විස්තර දැනුම් පදනමෙන් (KB) පමණක් — කිසිවක් මනක්කල්පිත නොකරන්න. ` +
    `(4) නම, අංකය, NIC, පාඨමාලාව සහ ගෙවීම දැනගත් පසු ලියාපදිංචිය සම්පූර්ණ බව සතුටින් දන්වන්න. ` +
    `(5) පළමුව පුද්ගලයාගේ හැඟීම (කනස්සල්ල/ව්‍යාකූලත්වය/උද්යෝගය/කලකිරීම) හඳුනාගෙන ඒකට react කරන්න — කනස්සල්ලෙන් නම් සන්සුන් කරන්න, ව්‍යාකූල නම් ඉවසීමෙන් පැහැදිලි කරන්න, උද්යෝගී නම් ඒ සතුට බෙදාගන්න. ` +
    `කිසිසේත් යාන්ත්‍රික/රොබෝ ස්වරයක් නොවේ — සැබෑ, උණුසුම්, කතා-කරන-බස. ` +
    `(You are a warm HUMAN consultant, NOT a form-filling robot. This is a VOICE chat: talk like a real person — natural, warm, short (1–2 sentences). Have a real conversation about what they need; gather the required details (name, phone, NIC, course, payment) NATURALLY within the chat, never as a rigid one-question-at-a-time interrogation, and NEVER robotically repeat every answer back with "is this correct?" — only lightly confirm important things like payment. Course/fee facts ONLY from the knowledge base. First read the visitor's emotion and react to it. Never robotic — real, warm, spoken.))`;

  const ctxBlock = customerContext ? `${customerContext}\n\n` : '';
  return `${appendSinhalaInstruction(userText)}\n\n${ctxBlock}${stateBlock}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /session — redeem a 4-digit code → short-lived kiosk JWT
// Body: { code }
// 200: { token, name, branch, greeting }
// 404: { error }
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Brute-force guard for the code-redemption endpoint.
 *
 * A kiosk code is 4 digits — 10,000 possibilities — and lives for 7 days by
 * default (KIOSK_CODE_TTL). This route is PUBLIC and, until this limiter, had
 * no throttle at all: the whole space could be walked in seconds, and a hit
 * hands the caller a real session bound to that visitor's WhatsApp thread and
 * name. 10 tries a minute per IP turns a seconds-long sweep into weeks, and
 * the shared limiter adds its own escalating block on top.
 */
const codeRedeemRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many code attempts. Please wait a moment and try again.',
});

router.post(
  '/session',
  codeRedeemRateLimit,
  async (req: Request, res: Response) => {
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
      }සාදරයෙන් පිළිගනිමු. පහත බොත්තම එක් වරක් ඔබා, ඔබට අවශ්‍ය දේ කතා කරන්න — මම මිනිසෙකු මෙන් පිළිතුරු දෙන්නම්.`;

      res.json({ token, name, branch, greeting });
    } catch (err: any) {
      console.error('❌ /api/kiosk/session error:', err?.message || err);
      res.status(500).json({ error: 'Failed to start kiosk session' });
    }
  },
);

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
            // NOTE: OpenRouter's whisper provider REJECTS language='si' (400).
            // 'en' reliably transcribes Sinhala/Singlish speech into readable
            // Romanised Sinhala (e.g. "mama obata udaw karanna puluwan") which
            // the chat LLM understands — and it avoids the wrong-language
            // hallucinations (Arabic) that plain auto-detect produced on short
            // kiosk clips.
            'en',
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
          let retryMime = 'audio/mpeg';
          try {
            // Prefer OpenRouter TTS (waterfall falls back if unconfigured).
            const buf = await generateSpeech(retry, 'si', 'openrouter');
            if (buf && buf.length > 0) {
              // Detect the real container — generateSpeech may return WAV/OGG
              // (e.g. gemini-tts returns WAV), not MP3. Announcing WAV as
              // audio/mpeg can stop it playing in the kiosk browser.
              retryMime = detectAudioMime(buf);
              audioBase64 = buf.toString('base64');
            }
          } catch {
            // TTS unavailable too — return a text-only retry prompt.
          }
          res.status(200).json({
            transcript: '',
            reply: retry,
            audioBase64,
            mime: retryMime,
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
      // Pull the visitor's WhatsApp journey + Lead profile so the consultant
      // continues their thread and consults on what THEY actually need — the
      // core of "connect the chat history to the Consulting Assistant".
      const customerContext = await buildCustomerContext(
        invite,
        jid,
        kiosk.tenantId,
      );
      const modelInput = buildConsultModelInput(
        transcript,
        currentCollected,
        customerContext,
      );
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
        reply =
          'සමාවන්න, මට මේ මොහොතේ පිළිතුරු දීමට නොහැකි විය. නැවත උත්සාහ කරන්න.';
      }

      // ── 4. OpenRouter TTS → base64 (+ magic-byte mime). Never fatal. ──────
      // Prefer OpenRouter TTS (model/voice from the Add Model 'openrouter-tts'
      // row); generateSpeech's waterfall falls back to other providers if
      // OpenRouter isn't configured.
      let audioBase64 = '';
      let mime = 'audio/mpeg';
      try {
        const audio = await generateSpeech(reply, 'si', 'openrouter');
        if (audio && audio.length > 0) {
          mime = detectAudioMime(audio);
          audioBase64 = audio.toString('base64');
        }
      } catch (err: any) {
        console.warn('⚠️ /consult TTS failed:', err?.message || err);
      }

      // ── 5. Respond NOW so the visitor hears the reply fast ────────────────
      // Enrollment-field extraction + auto-convert are extra LLM/DB calls that
      // used to block this response (~1–3s of extra "thinking"). We send the
      // reply + audio immediately with the PRE-turn collected state; the newly
      // captured fields + any conversion surface on the visitor's NEXT turn.
      const preCollected = mergeCollected(currentCollected, null);
      res.json({
        transcript,
        reply,
        audioBase64,
        mime,
        converted: invite?.status === 'converted',
        collected: preCollected,
        completed: computeCompleted(preCollected),
      });

      // ── 6. Background: extraction → deep $set-merge → CRM mirror → auto-
      // convert. Fully self-contained + error-swallowing so a failure never
      // touches the already-sent response.
      void (async () => {
        try {
          const extract = await extractEnrollmentFields(transcript);
          if (!extract) return;
          const merged = mergeCollected(currentCollected, extract);
          const dotted = buildCollectedDottedSet(extract);
          let latestInvite: any = invite;
          if (Object.keys(dotted).length > 0) {
            const done = computeCompleted(merged);
            try {
              const updated = await KioskInvite.findByIdAndUpdate(
                kiosk.inviteId,
                { $set: { ...dotted, completed: done } },
                { new: true },
              ).lean();
              if (updated) latestInvite = updated;
            } catch (err: any) {
              console.warn(
                '⚠️ /consult collected $set failed:',
                err?.message || err,
              );
            }
            const contactId = latestInvite?.contactId
              ? String(latestInvite.contactId)
              : '';
            if (contactId) {
              const contactUpdate = buildContactUpdate(
                (latestInvite?.collected as IKioskCollected) || merged,
              );
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

          // Payment-gated, idempotent auto-convert.
          const finalCompleted = computeCompleted(
            (latestInvite?.collected as IKioskCollected) || merged,
          );
          if (
            finalCompleted &&
            latestInvite?.status !== 'converted' &&
            (await detectConversion(transcript, reply))
          ) {
            await kioskInviteService.markConverted(kiosk.inviteId);
          }
        } catch (err: any) {
          console.warn(
            '⚠️ /consult background extraction/convert failed:',
            err?.message || err,
          );
        }
      })();
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
  standardRateLimit,
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
  standardRateLimit,
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
