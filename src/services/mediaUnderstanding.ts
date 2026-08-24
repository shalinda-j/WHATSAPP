import axios from 'axios';
import type { proto } from '@whiskeysockets/baileys';
import { describeMediaContent } from './gemini';
import { getOpenRouterApiKey } from './openrouterVoice';
import { loadBaileys } from './baileys';

/**
 * Media understanding for inbound WhatsApp messages.
 *
 * Voice notes already flow through voice.ts transcription; this module covers
 * everything else a customer can send — images, videos, documents and
 * stickers — by downloading the media and describing it with Gemini's
 * multimodal input, so the AI agent can "read" what the customer sent and
 * reply meaningfully instead of silently ignoring the message.
 */

export type IncomingMediaKind = 'image' | 'video' | 'document' | 'sticker';

export interface DetectedMedia {
  kind: IncomingMediaKind;
  mimeType: string;
  caption: string;
  fileName?: string;
  /** Raw media size as reported by WhatsApp, in bytes (0 when unknown). */
  fileLength: number;
}

export interface MediaAnalysis extends DetectedMedia {
  /** Gemini's description of the media. Empty when analysis wasn't possible. */
  description: string;
  /** Downloaded bytes, retained so Live Chat can persist and render them. */
  buffer?: Buffer;
}

// Gemini inline payloads are capped around 20MB for the whole request and
// base64 inflates bytes by ~4/3, so keep raw media comfortably below that.
const MAX_BYTES: Record<IncomingMediaKind, number> = {
  image: 8 * 1024 * 1024,
  sticker: 2 * 1024 * 1024,
  video: 14 * 1024 * 1024,
  document: 14 * 1024 * 1024,
};
const MAX_STORAGE_BYTES = 64 * 1024 * 1024;

// Gemini can read PDFs inline but not Office formats; images/videos are fine.
const ANALYZABLE_DOCUMENT_MIMES = new Set(['application/pdf']);

const PROMPTS: Record<IncomingMediaKind, string> = {
  image:
    'A customer sent this image to our WhatsApp business chat. Describe it factually in under 120 words: (1) what the image shows, (2) any visible text transcribed VERBATIM in its original language (keep Sinhala/Tamil Unicode), (3) if it looks like a document, form, receipt, certificate or qualification, state its key details (names, dates, grades, amounts). Return only the description.',
  video:
    'A customer sent this video to our WhatsApp business chat. In under 120 words, summarize what happens in the video and transcribe any speech or on-screen text in its original language (keep Sinhala/Tamil Unicode). Return only the summary.',
  document:
    'A customer sent this document to our WhatsApp business chat. In under 150 words, summarize what the document is and extract the key details: names, dates, qualifications, grades, amounts, contact details. Transcribe short important passages verbatim in their original language (keep Sinhala/Tamil Unicode). Return only the summary.',
  sticker:
    'A customer sent this sticker in our WhatsApp business chat. In one short sentence, describe what the sticker shows and the emotion or intent it conveys. Return only that sentence.',
};

// ── OpenRouter multimodal fallback ───────────────────────────────────────────
// Production deployments often have ONLY an OpenRouter key (no direct Gemini
// key), and describeMediaContent silently returns '' on MISSING_API_KEY — so
// image/PDF reading was dead in prod. This fallback routes the same analysis
// through OpenRouter's multimodal chat API (verified live: image_url + file
// parts on google/gemini-2.5-flash). Video isn't supported here — Gemini-direct
// remains the only video path.
const OPENROUTER_VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash';

async function describeViaOpenRouter(
  base64Data: string,
  mimeType: string,
  instruction: string,
): Promise<string> {
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) return '';

  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  let part: Record<string, unknown>;
  if (mimeType === 'application/pdf') {
    part = {
      type: 'file',
      file: { filename: 'document.pdf', file_data: dataUrl },
    };
  } else if (mimeType.startsWith('image/')) {
    part = { type: 'image_url', image_url: { url: dataUrl } };
  } else {
    return ''; // video/other — not supported via OpenRouter
  }

  const res = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: OPENROUTER_VISION_MODEL,
      messages: [
        { role: 'user', content: [{ type: 'text', text: instruction }, part] },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 90_000,
    },
  );
  return String(res.data?.choices?.[0]?.message?.content ?? '').trim();
}

const unwrap = (msg: any): any => {
  // Iteratively peel nested wrappers (e.g. a view-once INSIDE an ephemeral
  // envelope) until we reach the real content. A single-level unwrap missed
  // those combinations and dropped the media. Bounded loop guards any cycle.
  let cur = msg;
  for (let i = 0; i < 5 && cur; i++) {
    const inner =
      cur.ephemeralMessage?.message ??
      cur.viewOnceMessage?.message ??
      cur.viewOnceMessageV2?.message ??
      cur.viewOnceMessageV2Extension?.message;
    if (!inner) break;
    cur = inner;
  }
  return cur || null;
};

/**
 * Detect non-audio media on an inbound message. Returns null for plain text
 * (and for audio, which voice.ts owns).
 */
export function detectIncomingMedia(
  message: proto.IWebMessageInfo,
): DetectedMedia | null {
  const msg = unwrap(message.message);
  if (!msg) return null;

  const img = msg.imageMessage;
  if (img) {
    return {
      kind: 'image',
      mimeType: img.mimetype || 'image/jpeg',
      caption: img.caption || '',
      fileLength: Number(img.fileLength || 0),
    };
  }

  const vid = msg.videoMessage;
  if (vid) {
    return {
      kind: 'video',
      mimeType: vid.mimetype || 'video/mp4',
      caption: vid.caption || '',
      fileLength: Number(vid.fileLength || 0),
    };
  }

  const doc =
    msg.documentMessage ??
    msg.documentWithCaptionMessage?.message?.documentMessage;
  if (doc) {
    return {
      kind: 'document',
      mimeType: doc.mimetype || 'application/octet-stream',
      caption:
        doc.caption ||
        msg.documentWithCaptionMessage?.message?.documentMessage?.caption ||
        '',
      fileName: doc.fileName || undefined,
      fileLength: Number(doc.fileLength || 0),
    };
  }

  const sticker = msg.stickerMessage;
  if (sticker) {
    return {
      kind: 'sticker',
      mimeType: sticker.mimetype || 'image/webp',
      caption: '',
      fileLength: Number(sticker.fileLength || 0),
    };
  }

  return null;
}

/**
 * Download + describe inbound media. NEVER throws — returns the detected
 * media with an empty description when download or analysis fails, so the
 * caller can still acknowledge the media (caption, filename) gracefully.
 */
export async function analyzeIncomingMedia(
  message: proto.IWebMessageInfo,
  detected?: DetectedMedia | null,
): Promise<MediaAnalysis | null> {
  const media = detected ?? detectIncomingMedia(message);
  if (!media) return null;

  const result: MediaAnalysis = { ...media, description: '' };

  if (media.fileLength > MAX_STORAGE_BYTES) {
    console.warn(
      `   📦 ${media.kind} exceeds Live Chat's 64MB storage cap — metadata only`,
    );
    return result;
  }

  let buffer: Buffer | null = null;
  try {
    const { downloadMediaMessage } = await loadBaileys();
    buffer = (await downloadMediaMessage(
      message as any,
      'buffer',
      {},
    )) as Buffer;
  } catch (err: any) {
    console.error(
      `   ❌ Failed to download ${media.kind}:`,
      err?.message || err,
    );
    return result;
  }

  if (!buffer || buffer.length === 0) return result;
  if (buffer.length > MAX_STORAGE_BYTES) {
    console.warn(
      `   📦 Downloaded ${media.kind} exceeds Live Chat's 64MB storage cap`,
    );
    return result;
  }
  result.buffer = buffer;
  if (buffer.length > MAX_BYTES[media.kind]) {
    console.warn(
      `   📦 Downloaded ${media.kind} exceeds analysis cap (${buffer.length} bytes) — skipping`,
    );
    return result;
  }

  if (
    media.kind === 'document' &&
    !ANALYZABLE_DOCUMENT_MIMES.has(media.mimeType) &&
    !media.mimeType.startsWith('image/')
  ) {
    // Office/zip/etc. cannot be analyzed inline, but the bytes above are kept
    // so the operator can still download the attachment in Live Chat.
    return result;
  }

  const base64 = buffer.toString('base64');
  try {
    result.description = await describeMediaContent(
      base64,
      media.mimeType,
      PROMPTS[media.kind],
    );
  } catch (err: any) {
    console.error(
      `   ⚠️ Gemini ${media.kind} analysis failed:`,
      err?.message || err,
    );
  }

  // Gemini unavailable (no key) or failed → OpenRouter multimodal fallback.
  if (!result.description) {
    try {
      result.description = await describeViaOpenRouter(
        base64,
        media.mimeType,
        PROMPTS[media.kind],
      );
      if (result.description) {
        console.log(
          `   🖼️ ${media.kind} analyzed via OpenRouter fallback (${OPENROUTER_VISION_MODEL})`,
        );
      }
    } catch (err: any) {
      console.error(
        `   ⚠️ OpenRouter ${media.kind} analysis failed:`,
        err?.response?.status ?? '',
        err?.message || err,
      );
    }
  }

  return result;
}

/**
 * Build the text the AI pipeline should treat as the customer's message.
 * Keeps the customer's own caption first (their words carry the intent) and
 * appends a bracketed system note describing the attachment.
 */
export function buildMediaPromptText(analysis: MediaAnalysis): string {
  const kindLabels: Record<IncomingMediaKind, string> = {
    image: 'an image',
    video: 'a video',
    document: 'a document',
    sticker: 'a sticker',
  };

  const parts: string[] = [];
  if (analysis.caption.trim()) {
    parts.push(analysis.caption.trim());
  }

  let note = `[Customer sent ${kindLabels[analysis.kind]}`;
  if (analysis.fileName) note += ` named "${analysis.fileName}"`;
  if (analysis.description) {
    note += `. Content: ${analysis.description}]`;
  } else {
    note += `, but its content could not be analyzed automatically. Acknowledge that you received it and, if its content matters, politely ask them to describe it or send it as text.]`;
  }
  parts.push(note);

  return parts.join('\n');
}
