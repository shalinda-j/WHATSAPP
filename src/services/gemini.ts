import { GoogleGenerativeAI, ChatSession } from '@google/generative-ai';
import {
  AI_PERSONALITY,
  SINHALA_SYSTEM_PROMPT,
  JOB_KNOWLEDGE_BASE,
  CONVERSATION_EXAMPLES,
} from '../config/ai-personality';
import { AIService, AIChatMessage } from '../interfaces/AIService';

import Dataset from '../models/Dataset';

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Helper to fetch dynamic knowledge base
async function getDynamicKnowledgeBase(): Promise<string> {
  try {
    // Fetch all active datasets
    const datasets = await Dataset.find({ isActive: true });

    let dynamicContent = '';
    if (datasets.length > 0) {
      dynamicContent = '\n\n# 📂 Dynamic Datasets (From Admin Panel)\n';
      datasets.forEach((ds) => {
        dynamicContent += `\n## ${ds.name} (${ds.scope})\n${ds.content}\n---\n`;
      });
    }

    // Combine with static defaults
    return `${JOB_KNOWLEDGE_BASE}${dynamicContent}`;
  } catch (error) {
    console.error('Error fetching datasets:', error);
    return JOB_KNOWLEDGE_BASE; // Fallback to static
  }
}

// Ensure model is initialized (Note: System instruction will be set per-request for dynamic updates)
const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
});

// Store chat sessions for conversation memory
const chatSessions: Map<string, ChatSession> = new Map();

/**
 * Build conversation history from examples
 */
function buildExampleHistory() {
  const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

  for (const example of CONVERSATION_EXAMPLES) {
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
    const dynamicKB = await getDynamicKnowledgeBase();

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: `${AI_PERSONALITY}\n\n${dynamicKB}`,
    });
    return result.response.text();
  } catch (error) {
    console.error('Gemini API error:', error);
    throw error;
  }
}

/**
 * Generate a response in Sinhala for job-related queries
 */
export async function generateSinhalaResponse(prompt: string): Promise<string> {
  try {
    const dynamicKB = await getDynamicKnowledgeBase();

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: `${SINHALA_SYSTEM_PROMPT}\n\n${dynamicKB}`,
    });
    return result.response.text();
  } catch (error) {
    console.error('Gemini API error (Sinhala):', error);
    throw error;
  }
}

/**
 * Get or create a chat session for a user (enables conversation memory)
 * Now includes job knowledge base and example conversations
 * Note: Sessions initialized here currently use STATIC knowledge for simplicity.
 * To use dynamic knowledge in sessions, we'd need to refactor this to be async or inject context per message.
 */
export function getChatSession(userId: string): ChatSession {
  if (!chatSessions.has(userId)) {
    const chat = model.startChat({
      systemInstruction: `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}`, // Use static base for persistent sessions for now
      history: [
        {
          role: 'model',
          parts: [
            {
              text: '🙏 ආයුබෝවන්! මම ජයලත් ග්ලොබල් AI - ඔබේ විදේශ රැකියා AI සහායකයා. මම ඔබට උදව් කරන්න සූදානම්!',
            },
          ],
        },
        ...buildExampleHistory(),
      ],
    });
    chatSessions.set(userId, chat);
  }
  return chatSessions.get(userId)!;
}

/**
 * Send a message with conversation context
 */
export async function sendMessageWithMemory(
  userId: string,
  message: string,
): Promise<string> {
  try {
    const chat = getChatSession(userId);
    const result = await chat.sendMessage(message);
    return result.response.text();
  } catch (error) {
    console.error('Gemini chat error:', error);
    throw error;
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
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType = 'audio/ogg',
): Promise<string> {
  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: audioBase64,
        },
      },
      {
        text: 'Transcribe this audio message. Return only the transcription text. If the audio is in Sinhala or any other language, transcribe it in its original language using appropriate Unicode characters. If the audio is about jobs or recruitment, also provide helpful information.',
      },
    ]);
    return result.response.text();
  } catch (error) {
    console.error('Audio transcription error:', error);
    throw error;
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
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Data,
        },
      },
      {
        text: 'Extract all text from this image. Return ONLY the extracted text. Maintain the original formatting as much as possible. If the text is in Sinhala, use Sinhala Unicode.',
      },
    ]);
    return result.response.text();
  } catch (error) {
    console.error('Image OCR error:', error);
    throw error;
  }
}

/**
 * Detect booking intent from natural language
 */
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
  suggestedAction?: 'Book Visit' | 'Ask History' | 'None';
} | null> {
  try {
    const result = await model.generateContent([
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
    ]);

    const responseText = result.response
      .text()
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    return JSON.parse(responseText);
  } catch (error) {
    console.error('Lead analysis error:', error);
    return null;
  }
}

export { model, genAI };

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
    this.modelName = config.model || 'gemini-1.5-flash';
    this.name = `Gemini (${this.modelName})`;
    this.genAI = new GoogleGenerativeAI(this.apiKey);
  }

  async generateResponse(messages: AIChatMessage[]): Promise<string> {
    try {
      // Extract system prompt
      const systemMessage = messages.find((m) => m.role === 'system');
      const systemInstruction = systemMessage
        ? systemMessage.content
        : undefined;

      // Convert history (excluding system)
      const history = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      if (history.length === 0) return '';

      const lastMessage = history.pop(); // Remove last message to send it
      if (!lastMessage) return '';

      // Get model with dynamic system instruction
      const modelInstance = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction:
          systemInstruction || `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}`,
      });

      const chat = modelInstance.startChat({
        history: history as any,
      });

      const result = await chat.sendMessage(lastMessage.parts[0].text);
      return result.response.text();
    } catch (error) {
      console.error(`GeminiService (${this.modelName}) error:`, error);
      throw error;
    }
  }
}
