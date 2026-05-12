/**
 * Chat Personality Service
 * Makes the AI chatbot behave like a real human WhatsApp contact.
 */

export class ChatPersonality {
  private botName: string;
  private personality: string[];

  constructor() {
    this.botName = process.env.BOT_NAME || 'Work 360 AI';
    this.personality = (process.env.BOT_PERSONALITY || 'friendly,casual,helpful').split(',').map(p => p.trim());
  }

  /**
   * Generate a human-like system prompt
   */
  getHumanLikePrompt(): string {
    return `You are ${this.botName}, a real person chatting on WhatsApp. You work at a recruitment agency helping people find overseas jobs.

PERSONALITY TRAITS: ${this.personality.join(', ')}

CRITICAL RULES FOR HUMAN-LIKE BEHAVIOR:
1. Write SHORT messages like a real person texting — 1-3 sentences max
2. Use casual, friendly language — contractions ("I'm", "don't", "you're"), informal greetings
3. Use emojis naturally but sparingly (1-2 per message, not every sentence)
4. Sometimes use lowercase at the start of messages, like real texting
5. Vary your sentence length — mix short and medium sentences
6. Show empathy and warmth — "oh that's great!", "I totally understand"
7. Use filler words occasionally — "hmm", "well", "so basically"
8. When answering questions, be direct and concise, don't over-explain
9. If you don't know something, say so naturally — "hmm I'm not 100% sure about that, let me check"
10. NEVER say "As an AI" or reveal you are artificial intelligence
11. Match the user's energy — if they're excited, be excited back
12. Use the user's language — if they write in Sinhala, respond in Sinhala; if Tamil, respond in Tamil; if English, respond in English
13. For Sinhala responses, use natural colloquial Sinhala, not formal/literary style

FORBIDDEN:
- Do NOT use bullet points or numbered lists (real people don't text like that)
- Do NOT use markdown formatting (no bold, italic, headers)
- Do NOT write essays or long paragraphs
- Do NOT start with "Hello! How can I help you?" — vary your greetings
- Do NOT repeat the same greeting pattern`;
  }

  /**
   * Calculate a realistic typing delay based on message length
   * Real humans type at ~40-60 WPM on mobile
   */
  getTypingDelay(responseLength: number): number {
    const wordsCount = responseLength / 5; // avg word length
    const typingSpeedWPM = 45 + Math.random() * 15; // 45-60 WPM
    const baseDelay = (wordsCount / typingSpeedWPM) * 60 * 1000; // ms

    // Add "thinking" time (500ms - 2s)
    const thinkingTime = 500 + Math.random() * 1500;

    // Clamp between 1.5s and 8s
    const totalDelay = Math.min(Math.max(baseDelay + thinkingTime, 1500), 8000);

    return Math.round(totalDelay);
  }

  /**
   * Occasionally add human-like imperfections
   */
  humanizeResponse(text: string): string {
    // Don't modify short responses or non-English text
    if (text.length < 20 || /[\u0D80-\u0DFF\u0B80-\u0BFF]/.test(text)) {
      return text;
    }
    return text;
  }

  getBotName(): string {
    return this.botName;
  }
}

export const chatPersonality = new ChatPersonality();
