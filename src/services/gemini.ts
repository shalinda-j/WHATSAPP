import { GoogleGenerativeAI, ChatSession } from '@google/generative-ai';
import {
  AI_PERSONALITY,
  SINHALA_SYSTEM_PROMPT,
  JOB_KNOWLEDGE_BASE,
  getConversationExamples,
} from '../config/ai-personality';
import { AIService, AIChatMessage } from '../interfaces/AIService';

import Dataset from '../models/Dataset';
import { configService } from './ConfigService';
import { withTimeout } from './withTimeout';
import { GEMINI_DEFAULT_MODEL } from '../config/brand';
import { coerceToSupportedGeminiModel } from '../config/geminiModels';

// Hard ceiling on any single Gemini network call. Prevents a hung request
// from blocking the AILoadBalancer fallback chain indefinitely.
const TIMEOUT = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 45000;

// Initialize Gemini AI (Removed global static init)
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
// const model = ...

/**
 * Helper to get a dynamic model instance with the latest API Key
 */
async function getGeminiModel(modelName = GEMINI_DEFAULT_MODEL) {
  // First, check the database for an active Google provider config
  const apiKey = await configService.getGoogleProviderKey();

  // Fallback to environment variables if DB config is missing
  const validKey = apiKey || process.env.GEMINI_API_KEY;

  if (!validKey || validKey === 'your_gemini_api_key_here') {
    throw new Error('MISSING_API_KEY');
  }

  const genAI = new GoogleGenerativeAI(validKey);

  // Try to get the specific model assigned to the provider, or fallback to the requested model Name
  let activeModel = modelName;
  try {
    const configModel = await import('../models/Config').then((m) =>
      m.default.findOne({
        isProvider: true,
        providerType: 'google',
        isActive: true,
      }),
    );
    if (configModel && configModel.aiModel) {
      activeModel = configModel.aiModel;
    }
  } catch (e) {
    console.error('Error fetching preferred model, falling back to default.');
  }

  // Runtime guard: a stale DB value (e.g. retired 1.5/2.0 → 404, or paid-only
  // 3.x → 429 on a free key) must never reach the API. Coerce to a supported
  // model regardless of what the DB/migration left behind.
  const safeModel = coerceToSupportedGeminiModel(activeModel);
  if (safeModel !== activeModel) {
    console.warn(
      `⚠️ Coercing unsupported Gemini model "${activeModel}" → "${safeModel}" at call time.`,
    );
  }

  return genAI.getGenerativeModel({ model: safeModel });
}

// Store chat sessions for conversation memory.
//
// Cap at MAX_CHAT_SESSIONS entries: when the limit is hit, the oldest entry
// (first-inserted — Map iteration order is insertion order) is evicted before
// adding the new one. This bounds worst-case memory to ~MAX * (session object
// size), typically a few MB, preventing the unbounded growth that would
// eventually OOM a long-running production server.
const MAX_CHAT_SESSIONS = 500;

// Idle TTL: sessions untouched for longer than this are considered stale and
// evicted on access. The 500-entry cap remains a hard backstop.
const SESSION_TTL_MS = Number(process.env.GEMINI_SESSION_TTL_MS) || 1800000;

interface ChatSessionEntry {
  session: ChatSession;
  lastAccess: number;
}

const chatSessions: Map<string, ChatSessionEntry> = new Map();

/**
 * Drop any session idle longer than SESSION_TTL_MS. Called on access so stale
 * entries don't linger forever between the FIFO cap evictions.
 */
function evictStaleSessions(): void {
  const now = Date.now();
  for (const [key, entry] of chatSessions) {
    if (now - entry.lastAccess > SESSION_TTL_MS) {
      chatSessions.delete(key);
    }
  }
}

function addChatSession(userId: string, session: ChatSession): void {
  if (chatSessions.size >= MAX_CHAT_SESSIONS) {
    // Evict the oldest (first) entry.
    const oldestKey = chatSessions.keys().next().value;
    if (oldestKey !== undefined) chatSessions.delete(oldestKey);
  }
  chatSessions.set(userId, { session, lastAccess: Date.now() });
}

/**
 * Build conversation history from examples
 */
async function buildExampleHistory() {
  const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

  const examples = await getConversationExamples();
  for (const example of examples) {
    history.push({ role: 'user', parts: [{ text: example.user }] });
    history.push({ role: 'model', parts: [{ text: example.assistant }] });
  }

  return history;
}

/**
 * Generate a response using Gemini AI
 */
export async function generateResponse(prompt: string): Promise<string> {
  try {
    const dynamicKB = await configService.getDynamicKnowledgeBase();
    const aiPersonality = await configService.getAIPersonality();

    // Get Dynamic Model
    const model = await getGeminiModel();

    const result = await withTimeout(
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: `${aiPersonality}\n\n${dynamicKB}`,
      }),
      TIMEOUT,
      'gemini',
    );
    return result.response.text();
  } catch (error: any) {
    if (error.message === 'MISSING_API_KEY') {
      return '⚠️ Google Gemini API Key is missing. Please configure it in the Admin Panel.';
    }
    console.error('Gemini API error:', error);
    throw error;
  }
}

/**
 * Generate a response in Sinhala for job-related queries
 */
export async function generateSinhalaResponse(prompt: string): Promise<string> {
  try {
    const dynamicKB = await configService.getDynamicKnowledgeBase();
    const model = await getGeminiModel();

    const result = await withTimeout(
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: `${SINHALA_SYSTEM_PROMPT}\n\n${dynamicKB}`,
      }),
      TIMEOUT,
      'gemini',
    );
    return result.response.text();
  } catch (error: any) {
    if (error.message === 'MISSING_API_KEY') {
      return '⚠️ Google Gemini API Key is missing. Please configure it in the Admin Panel.';
    }
    console.error('Gemini API error (Sinhala):', error);
    throw error;
  }
}

/**
 * Get or create a chat session for a user (enables conversation memory)
 */
export async function getChatSession(userId: string): Promise<ChatSession> {
  // Drop stale (idle) sessions before reading/writing.
  evictStaleSessions();

  const existing = chatSessions.get(userId);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing.session;
  }

  const model = await getGeminiModel();
  const exampleHistory = await buildExampleHistory();
  const chat = model.startChat({
    systemInstruction: `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}`,
    // Gemini requires the first history turn to be 'user'. The example
    // history already starts with a user turn; we must NOT prepend a 'model'
    // greeting here or the very first sendMessage 400s.
    history: [...exampleHistory],
  });
  addChatSession(userId, chat);
  return chat;
}

/**
 * Send a message with conversation context
 */
export async function sendMessageWithMemory(
  userId: string,
  message: string,
): Promise<string> {
  try {
    const chat = await getChatSession(userId);
    const result = await withTimeout(
      chat.sendMessage(message),
      TIMEOUT,
      'gemini',
    );
    return result.response.text();
  } catch (error: any) {
    if (error.message === 'MISSING_API_KEY') {
      return '⚠️ Google Gemini API Key is missing. Please configure it in the Admin Panel (AI Providers -> Google) to enable AI responses.';
    }
    console.error('Gemini chat error:', error);
    return '⚠️ Sorry, an error occurred while processing your message.';
  }
}

/**
 * Clear conversation history for a user
 */
export function clearConversation(userId: string): void {
  chatSessions.delete(userId);
  console.log(`🗑️ Conversation cleared for: ${userId}`);
}

/**
 * Transcribe audio using Gemini's multimodal capabilities
 * Returns transcription with automatic language detection
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType = 'audio/ogg',
): Promise<string> {
  try {
    const model = await getGeminiModel();
    const result = await withTimeout(
      model.generateContent([
        {
          inlineData: {
            mimeType: mimeType,
            data: audioBase64,
          },
        },
        {
          text: 'Transcribe this audio message accurately. The audio may be in Sinhala (සිංහල), English, or Tamil (தமிழ்). Return ONLY the transcription text in the original language using appropriate Unicode characters.',
        },
      ]),
      TIMEOUT,
      'gemini-transcribe',
    );

    const transcribed = result.response.text().trim();
    // If Gemini returns meta-commentary instead of transcription, return empty
    if (
      transcribed.toLowerCase().includes('transcription:') ||
      transcribed.toLowerCase().startsWith('the audio') ||
      transcribed.toLowerCase().startsWith('this audio') ||
      transcribed.toLowerCase().startsWith('i cannot')
    ) {
      return '';
    }
    return transcribed;
  } catch (error: any) {
    if (error.message === 'MISSING_API_KEY') {
      return ''; // Missing API key — return empty, caller will try other providers
    }
    console.error('Gemini STT error:', error.message || error);
    throw error; // Let caller handle (voice.ts catches all STT errors)
  }
}

/**
 * Extract text from an image (OCR) using Gemini
 */
export async function extractTextFromImage(
  base64Data: string,
  mimeType: string,
): Promise<string> {
  try {
    const model = await getGeminiModel();
    const result = await withTimeout(
      model.generateContent([
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data,
          },
        },
        {
          text: 'Extract all text from this image. Return ONLY the extracted text. Maintain the original formatting as much as possible. If the text is in Sinhala, use Sinhala Unicode.',
        },
      ]),
      TIMEOUT,
      'gemini-ocr',
    );
    return result.response.text();
  } catch (error: any) {
    if (error.message === 'MISSING_API_KEY') {
      return ''; // Missing API key, skip OCR
    }
    console.error('Image OCR error:', error);
    throw error;
  }
}

/**
 * Describe arbitrary media (image, video, PDF/document, sticker) using
 * Gemini's multimodal input. The instruction controls what the model
 * returns — callers tailor it per media kind. Returns '' when the API key
 * is missing so callers can degrade gracefully.
 */
export async function describeMediaContent(
  base64Data: string,
  mimeType: string,
  instruction: string,
): Promise<string> {
  try {
    const model = await getGeminiModel();
    const result = await withTimeout(
      model.generateContent([
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data,
          },
        },
        { text: instruction },
      ]),
      TIMEOUT,
      'gemini-media',
    );
    return result.response.text().trim();
  } catch (error: any) {
    if (error.message === 'MISSING_API_KEY') {
      return '';
    }
    console.error('Media description error:', error.message || error);
    throw error;
  }
}

/**
 * Analyze the user's message for lead qualification data and intent
 */
export async function analyzeLeadIntent(text: string): Promise<{
  intent: 'Check Availability' | 'Lead Info' | 'None';
  leadData?: {
    name?: string;
    age?: string;
    education?: string;
    location?: string;
  };
  bookingDetails?: { date?: string; time?: string };
  buyingSignal: 'High' | 'Medium' | 'Low';
  suggestion?: 'Book Visit' | 'Ask History' | 'None';
} | null> {
  try {
    const model = await getGeminiModel();

    const result = await withTimeout(
      model.generateContent([
        {
          text: `You are a Lead Analyzer for a Recruitment Agency. Analyze the user's message.
                Extract any provided personal details, determine the "Buying Signal", and check for booking requests.
                Current Date: ${new Date().toISOString()}

                User Message: "${text}"

                Output Format (JSON Only):
                {
                    "intent": "Check Availability" (asking for time/visit) OR "Lead Info" (providing details) OR "Price Enquiry" OR "General Info",
                    "leadData": {
                        "name": "Extract if present, else null",
                        "age": "Extract if present, else null",
                        "education": "Extract if present (OL/AL/Degree), else null",
                        "location": "Extract if present, else null"
                    },
                    "bookingDetails": {
                        "date": "YYYY-MM-DD" (if intent is Check Availability, default to tomorrow if unspecified),
                        "time": "HH:mm" (24-hour format, default 09:00)
                    },
                    "buyingSignal": "High" (Asking Price/Location/Visit/Salary) OR "Medium" (Asking General Info/Courses) OR "Low",
                    "suggestedAction": "Book Visit" (If signal High & Details present) OR "Ask History" (If details missing & asking price) OR "None"
                }`,
        },
      ]),
      TIMEOUT,
      'gemini-lead-intent',
    );

    const responseText = result.response
      .text()
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    return JSON.parse(responseText);
  } catch (error: any) {
    if (error.message !== 'MISSING_API_KEY') {
      console.error('Lead analysis error:', error);
    }
    return null;
  }
}

/**
 * Shape of the enrollment fields that can be extracted from a single user
 * utterance. ALL fields are optional: the extractor only returns the keys it
 * believes were NEWLY mentioned in the supplied text so callers can deep-merge
 * the result into a running `collected` state.
 */
export type EnrollmentExtract = {
  personal?: {
    fullName?: string;
    mobile?: string;
    nic?: string;
    email?: string;
    address?: string;
  };
  course?: {
    program?: string;
    level?: string;
  };
  payment?: {
    paid?: boolean;
    amount?: string;
    method?: string;
    reference?: string;
  };
};

/**
 * Extract enrollment-related fields that the user newly mentioned in `text`.
 *
 * Returns ONLY the fields present in this utterance (so the caller can deep
 * $set-merge the partial result). Mirrors the `analyzeLeadIntent` idiom: a
 * JSON-only Gemini prompt, strip ```json fences, JSON.parse, and a
 * try/catch -> null so a parse/timeout/missing-key failure NEVER throws or
 * breaks the caller.
 */
export async function extractEnrollmentFields(
  text: string,
): Promise<EnrollmentExtract | null> {
  try {
    const model = await getGeminiModel();

    const result = await withTimeout(
      model.generateContent([
        {
          text: `You extract enrollment registration fields from a single student message for an education institute kiosk.
Return ONLY the fields that are NEWLY MENTIONED in this exact message. Do NOT guess, infer, or carry over previous values. If a field is not mentioned, OMIT the key entirely (do not output null/empty).

User Message: "${text}"

Output Format (JSON Only, omit any key not mentioned):
{
  "personal": {
    "fullName": "the person's full name",
    "mobile": "phone/mobile number as digits",
    "nic": "national identity card number",
    "email": "email address",
    "address": "home/postal address"
  },
  "course": {
    "program": "course or program name",
    "level": "course level e.g. Certificate/Diploma/HND/Degree"
  },
  "payment": {
    "paid": true,
    "amount": "amount paid as a string",
    "method": "payment method e.g. cash/card/bank transfer",
    "reference": "payment reference/receipt number"
  }
}
Set payment.paid to true ONLY if the user clearly states they have paid; set false ONLY if they clearly state they have not paid; otherwise omit it.
Output the JSON object only, with no commentary.`,
        },
      ]),
      TIMEOUT,
      'gemini-enrollment-extract',
    );

    const responseText = result.response
      .text()
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(responseText) as EnrollmentExtract;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error: any) {
    if (error.message !== 'MISSING_API_KEY') {
      console.error('Enrollment field extraction error:', error);
    }
    return null;
  }
}

// Remove exports of internal model/genAI if possible, or export dummy to prevent breakage
// export { model, genAI };
// Since we removed global model, we should remove it from exports or provide a getter
// But other files might be importing them. Let's see...
// I will not export them. If something breaks, I'll fix the caller.

type GeminiTurn = { role: 'user' | 'model'; parts: { text: string }[] };

/**
 * Normalise a generic chat-message list into a Gemini-VALID multiturn
 * payload. The Gemini API rejects a chat history that:
 *   (a) does not begin with a 'user' turn,
 *   (b) does not strictly alternate user / model, or
 *   (c) contains empty parts.
 * Crucially these 400s only fire once a conversation HAS history — i.e. the
 * customer's SECOND message — which is exactly the "first reply works, the
 * next one falls back to the canned template" bug. By sanitising here we
 * guarantee a valid request regardless of what the app accumulated (seeded
 * examples, agent history windows starting mid-turn, duplicate user turns).
 *
 * Returns null when there is no user turn to send (caller treats as "".)
 */
export function buildGeminiPayload(messages: AIChatMessage[]): {
  systemInstruction?: string;
  history: GeminiTurn[];
  sendText: string;
} | null {
  const systemInstruction =
    messages.find((m) => m.role === 'system')?.content?.trim() || undefined;

  // Map to user/model turns, trim, drop empties and stray system turns.
  const mapped = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      text: (m.content ?? '').trim(),
    }))
    .filter((t) => t.text.length > 0);

  // Merge consecutive same-role turns so the sequence strictly alternates.
  const merged: { role: 'user' | 'model'; text: string }[] = [];
  for (const turn of mapped) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) {
      prev.text += '\n' + turn.text;
    } else {
      merged.push({ ...turn });
    }
  }

  // The final turn is the message we actually send; it must be a user turn.
  const last = merged[merged.length - 1];
  if (!last || last.role !== 'user') return null;
  const sendText = last.text;

  // History = everything before the final user turn. Drop a leading model
  // turn so it begins with 'user' (merging already guarantees alternation,
  // so there can be at most one leading model turn).
  let history = merged.slice(0, -1);
  if (history.length > 0 && history[0].role === 'model') {
    history = history.slice(1);
  }

  return {
    systemInstruction,
    history: history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    sendText,
  };
}

export class GeminiService implements AIService {
  name: string;
  private apiKey: string;
  private modelName: string;
  private genAI: GoogleGenerativeAI;

  constructor(config: {
    apiKey: string;
    model?: string;
    providerType?: string;
  }) {
    this.apiKey = config.apiKey;
    // Runtime guard: never instantiate against a retired (404) or paid-only
    // (429 on free tier) model, even if the DB/config still pins one.
    this.modelName = coerceToSupportedGeminiModel(
      config.model || GEMINI_DEFAULT_MODEL,
    );
    this.name = `Gemini (${this.modelName})`;
    this.genAI = new GoogleGenerativeAI(this.apiKey);
  }

  async generateResponse(messages: AIChatMessage[]): Promise<string> {
    try {
      if (!this.apiKey || this.apiKey === 'your_gemini_api_key_here') {
        return '⚠️ Google Gemini API Key is missing. Please configure it in the Admin Panel to enable AI Features.';
      }

      // Sanitise into a Gemini-valid payload (starts with user, alternates,
      // no empty parts). This is what makes follow-up turns work instead of
      // 400-ing and collapsing into the canned fallback template.
      const payload = buildGeminiPayload(messages);
      if (!payload) return '';

      const aiPersonality = await configService.getAIPersonality();
      const dynamicKB = await configService.getDynamicKnowledgeBase();

      const modelInstance = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction:
          payload.systemInstruction || `${aiPersonality}\n\n${dynamicKB}`,
      });

      const chat = modelInstance.startChat({
        history: payload.history as any,
      });

      const result = await withTimeout(
        chat.sendMessage(payload.sendText),
        TIMEOUT,
        'gemini',
      );
      return result.response.text();
    } catch (error: any) {
      // Surface the real Gemini error message (model retired, quota, history
      // shape) so production logs explain WHY a turn fell back, instead of a
      // silent collapse into the lead-fallback template.
      console.error(
        `GeminiService (${this.modelName}) error:`,
        error?.message || error,
      );
      throw error;
    }
  }
}
