import { GoogleGenerativeAI, ChatSession } from '@google/generative-ai';
import {
  AI_PERSONALITY,
  SINHALA_SYSTEM_PROMPT,
  JOB_KNOWLEDGE_BASE,
  CONVERSATION_EXAMPLES,
} from '../config/ai-personality';
import { AIService, AIChatMessage } from '../interfaces/AIService';

import Dataset from '../models/Dataset';
import { configService } from './ConfigService';

// Initialize Gemini AI (Removed global static init)
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
// const model = ...

/**
 * Helper to get a dynamic model instance with the latest API Key
 */
async function getGeminiModel(modelName = 'gemini-1.5-flash-latest') {
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
    const configModel = await import('../models/Config').then(m => m.default.findOne({ isProvider: true, providerType: 'google', isActive: true }));
    if (configModel && configModel.aiModel) {
      activeModel = configModel.aiModel;
    }
  } catch (e) {
    console.error('Error fetching preferred model, falling back to default.');
  }

  return genAI.getGenerativeModel({ model: activeModel });
}

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
    const dynamicKB = await configService.getDynamicKnowledgeBase();
    const aiPersonality = await configService.getAIPersonality();

    // Get Dynamic Model
    const model = await getGeminiModel();

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: `${aiPersonality}\n\n${dynamicKB}`,
    });
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

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: `${SINHALA_SYSTEM_PROMPT}\n\n${dynamicKB}`,
    });
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
  if (!chatSessions.has(userId)) {
    const model = await getGeminiModel();
    const chat = model.startChat({
      systemInstruction: `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}`,
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
    const chat = await getChatSession(userId);
    const result = await chat.sendMessage(message);
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
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType = 'audio/ogg',
): Promise<string> {
  try {
    const model = await getGeminiModel();
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: audioBase64,
        },
      },
      {
        text: 'Transcribe this audio message accurately. The audio may be in Sinhala (සිංහල), English, or Tamil (தமிழ்). Return ONLY the transcription text in the original language using appropriate Unicode characters.',
      },
    ]);
    return result.response.text();
  } catch (error: any) {
    if (error.message === 'MISSING_API_KEY') {
      return ''; // Missing API key, skip transcription
    }
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
    const model = await getGeminiModel();
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
  } catch (error: any) {
    if (error.message === 'MISSING_API_KEY') {
      return ''; // Missing API key, skip OCR
    }
    console.error('Image OCR error:', error);
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
  } catch (error: any) {
    if (error.message !== 'MISSING_API_KEY') {
      console.error('Lead analysis error:', error);
    }
    return null;
  }
}

// Remove exports of internal model/genAI if possible, or export dummy to prevent breakage
// export { model, genAI }; 
// Since we removed global model, we should remove it from exports or provide a getter
// But other files might be importing them. Let's see...
// I will not export them. If something breaks, I'll fix the caller.


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
    this.modelName = config.model || 'gemini-1.5-flash-latest';
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
      const aiPersonality = await configService.getAIPersonality();
      const dynamicKB = await configService.getDynamicKnowledgeBase();

      if (!this.apiKey || this.apiKey === 'your_gemini_api_key_here') {
        return '⚠️ Google Gemini API Key is missing. Please configure it in the Admin Panel to enable AI Features.';
      }

      const modelInstance = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction:
          systemInstruction || `${aiPersonality}\n\n${dynamicKB}`,
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
