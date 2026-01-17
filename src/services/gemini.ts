import { GoogleGenerativeAI, ChatSession } from '@google/generative-ai';
import { AI_PERSONALITY, SINHALA_SYSTEM_PROMPT, JOB_KNOWLEDGE_BASE, CONVERSATION_EXAMPLES } from '../config/ai-personality';

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Use gemini-2.5-flash (stable, good quotas)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction: `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}`
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
    const result = await model.generateContent([
      { text: AI_PERSONALITY },
      { text: JOB_KNOWLEDGE_BASE },
      { text: prompt }
    ]);
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
    const result = await model.generateContent([
      { text: SINHALA_SYSTEM_PROMPT },
      { text: JOB_KNOWLEDGE_BASE },
      { text: prompt }
    ]);
    return result.response.text();
  } catch (error) {
    console.error('Gemini API error (Sinhala):', error);
    throw error;
  }
}

/**
 * Get or create a chat session for a user (enables conversation memory)
 * Now includes job knowledge base and example conversations
 */
export function getChatSession(userId: string): ChatSession {
  if (!chatSessions.has(userId)) {
    const chat = model.startChat({
      history: [
        // Initialize with system instructions and knowledge base
        {
          role: 'user',
          parts: [{ text: `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}` }]
        },
        {
          role: 'model',
          parts: [{ text: '🙏 ආයුබෝවන්! මම ජොබ් අසිස්ට් - ඔබේ ඊශ්‍රායල ඉදිකිරීම් රැකියා AI සහායකයා. මම ඔබට උදව් කරන්න සූදානම්!' }]
        },
        // Add example conversations for better responses
        ...buildExampleHistory()
      ]
    });
    chatSessions.set(userId, chat);
  }
  return chatSessions.get(userId)!;
}

/**
 * Send a message with conversation context
 */
export async function sendMessageWithMemory(userId: string, message: string): Promise<string> {
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
export async function transcribeAudio(audioBase64: string, mimeType: string = 'audio/ogg'): Promise<string> {
  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: audioBase64
        }
      },
      { text: 'Transcribe this audio message. Return only the transcription text. If the audio is in Sinhala or any other language, transcribe it in its original language using appropriate Unicode characters. If the audio is about jobs or recruitment, also provide helpful information.' }
    ]);
    return result.response.text();
  } catch (error) {
    console.error('Audio transcription error:', error);
    throw error;
  }
}

export { model, genAI };
