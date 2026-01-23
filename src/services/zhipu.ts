import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { AI_PERSONALITY, SINHALA_SYSTEM_PROMPT, JOB_KNOWLEDGE_BASE, CONVERSATION_EXAMPLES } from '../config/ai-personality';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Initialize Zhipu AI client (via OpenAI SDK)
const client = new OpenAI({
    apiKey: process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || '',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
});

// Store chat histories for memory
const chatHistories: Map<string, ChatCompletionMessageParam[]> = new Map();

/**
 * Build conversation history from examples
 */
function buildExampleHistory(): ChatCompletionMessageParam[] {
    const history: ChatCompletionMessageParam[] = [];

    for (const example of CONVERSATION_EXAMPLES) {
        history.push({ role: 'user', content: example.user });
        history.push({ role: 'assistant', content: example.assistant });
    }

    return history;
}

/**
 * Get or create chat history for a user
 */
function getChatHistory(userId: string): ChatCompletionMessageParam[] {
    if (!chatHistories.has(userId)) {
        chatHistories.set(userId, [
            {
                role: 'system',
                content: `${AI_PERSONALITY}\n\n${JOB_KNOWLEDGE_BASE}`
            },
            {
                role: 'assistant',
                content: '🙏 ආයුබෝවන්! මම ජොබ් අසිස්ට් - ඔබේ ඊශ්‍රායල ඉදිකිරීම් රැකියා AI සහායකයා. මම ඔබට උදව් කරන්න සූදානම්!'
            },
            ...buildExampleHistory()
        ]);
    }
    return chatHistories.get(userId)!;
}

/**
 * Generate a response using Zhipu AI (GLM-4-Flash)
 */
export async function sendMessageWithMemory(userId: string, message: string): Promise<string> {
    try {
        const history = getChatHistory(userId);

        // Add user message to history
        history.push({ role: 'user', content: message });

        const response = await client.chat.completions.create({
            model: 'glm-4-flash', // Fast & free Zhipu model
            messages: history,
            stream: false,
            tools: [{ type: 'web_search', web_search: { search_result: true, search_query: true } }] as any, // Enable web search
        });

        const reply = response.choices[0]?.message?.content || '';

        // Add assistant reply to history
        if (reply) {
            history.push({ role: 'assistant', content: reply });
        }

        return reply;
    } catch (error) {
        console.error('Zhipu API error:', error);
        throw error;
    }
}

/**
 * Clear conversation history for a user
 */
export function clearConversation(userId: string): void {
    chatHistories.delete(userId);
    console.log(`🗑️ Conversation cleared for: ${userId}`);
}

/**
 * Transcribe audio using Zhipu's Audio API (GLM-4-Voice / GLM-ASR implied)
 * Zhipu supports OpenAI-compatible audio/transcriptions endpoint
 */
export async function transcribeAudio(audioBase64: string, mimeType: string = 'audio/ogg'): Promise<string> {
    try {
        // Convert base64 to a temporary file because OpenAI SDK needs a file object
        const buffer = Buffer.from(audioBase64, 'base64');
        const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
        fs.writeFileSync(tempFilePath, new Uint8Array(buffer));

        const transcription = await client.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: 'glm-asr', // Zhipu ASR model for transcription
        });

        // Clean up temp file
        fs.unlinkSync(tempFilePath);

        return transcription.text;
    } catch (error) {
        console.error('Audio transcription error:', error);
        // Fallback or rethrow
        throw error;
    }
}

/**
 * Detect booking intent from natural language using Zhipu GLM
 */
export async function detectBookingIntent(text: string): Promise<{ intent: 'CHECK_AVAILABILITY' | 'NONE'; date?: string; time?: string } | null> {
    try {
        const response = await client.chat.completions.create({
            model: 'glm-4-flash',
            messages: [
                {
                    role: 'system',
                    content: `You are a booking intent detector. Analyze the user's message.
If they are asking to schedule a visit, appointment, or suggesting a time, return a JSON object.
Current Date: ${new Date().toISOString()}

Output Format (JSON Only):
{
    "intent": "CHECK_AVAILABILITY",
    "date": "YYYY-MM-DD",
    "time": "HH:mm" (24-hour format)
}

If no specific time is mentioned, default time to "09:00".
If no specific date is mentioned, use tomorrow's date.
If the user is NOT asking to book or check availability, return:
{ "intent": "NONE" }`
                },
                {
                    role: 'user',
                    content: text
                }
            ],
            stream: false,
        });

        const responseText = response.choices[0]?.message?.content || '';
        const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (error) {
        console.error('Intent detection error (Zhipu):', error);
        return null;
    }
}
