import axios from 'axios';
import { randomUUID } from 'crypto';
import { AIService, AIChatMessage } from '../interfaces/AIService';

// OpenAI migrated ChatGPT from chat.openai.com to chatgpt.com. The session
// cookie (__Secure-next-auth.session-token) is now issued for the chatgpt.com
// domain, so validation MUST hit chatgpt.com — hitting the old host redirects
// and can drop/mismatch the cookie, which surfaced as a false "expired" error.
const CHATGPT_BASE = 'https://chatgpt.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua':
    '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

const MIN_REQUEST_GAP_MS = 3000;
const JITTER_MIN_MS = 500;
const JITTER_MAX_MS = 1500;
const REQUEST_TIMEOUT_MS = 90000;

export class SessionExpiredError extends Error {
  code = 'SESSION_EXPIRED' as const;
  constructor(message = 'ChatGPT session token expired or invalid') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class RateLimitedError extends Error {
  code = 'RATE_LIMITED' as const;
  constructor(message = 'ChatGPT rate limit hit') {
    super(message);
    this.name = 'RateLimitedError';
  }
}

interface ChatGPTSessionConfig {
  sessionToken: string;
  model?: string;
  configId?: string;
  providerType?: string;
}

export interface ChatGPTSessionInfo {
  accessToken: string;
  email?: string;
  expires: string;
}

export class ChatGPTSessionService implements AIService {
  name: string;
  configId?: string;
  private sessionToken: string;
  private modelName: string;
  private accessToken: string | null = null;
  private accessTokenExpiry = 0;
  private lastRequestAt = 0;

  constructor(config: ChatGPTSessionConfig) {
    this.sessionToken = config.sessionToken;
    this.modelName = config.model || 'text-davinci-002-render-sha';
    this.configId = config.configId;
    this.name = `ChatGPT-Session (${this.modelName})`;
  }

  static async validateSession(
    sessionToken: string,
  ): Promise<ChatGPTSessionInfo> {
    try {
      const res = await axios.get(`${CHATGPT_BASE}/api/auth/session`, {
        headers: {
          ...COMMON_HEADERS,
          Accept: 'application/json',
          Referer: `${CHATGPT_BASE}/`,
          Origin: CHATGPT_BASE,
          Cookie: `__Secure-next-auth.session-token=${sessionToken}`,
        },
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: () => true,
      });

      if (res.status === 401 || res.status === 403) {
        throw new SessionExpiredError();
      }

      // Cloudflare / bot challenge: the endpoint returns 200 with an HTML
      // body instead of JSON. Detect it so the operator gets a useful message
      // instead of a confusing "No accessToken" expiry error.
      const isHtml =
        typeof res.data === 'string' &&
        /<\s*html|cf-browser-verification|just a moment/i.test(res.data);
      if (isHtml || res.status === 503) {
        throw new Error(
          'ChatGPT blocked the request with a Cloudflare/bot challenge (HTTP ' +
            `${res.status}). Server IPs are often blocked — this unofficial ` +
            'method may not work from a hosted server. Prefer an official ' +
            'API-key provider (Gemini / OpenAI / Groq) or a Custom endpoint.',
        );
      }

      if (res.status !== 200 || !res.data) {
        throw new Error(`Validation failed (HTTP ${res.status})`);
      }

      // The body should be a JSON object. Some proxies hand back a string.
      const body =
        typeof res.data === 'string'
          ? (() => {
              try {
                return JSON.parse(res.data);
              } catch {
                return {};
              }
            })()
          : res.data;

      // An empty {} means logged-out (cookie expired/invalid).
      if (!body.accessToken) {
        throw new SessionExpiredError(
          'No accessToken returned — cookie is expired or for the wrong domain (use chatgpt.com).',
        );
      }

      return {
        accessToken: body.accessToken,
        email: body.user?.email,
        expires: body.expires,
      };
    } catch (err: any) {
      if (err instanceof SessionExpiredError) throw err;
      if (err.code === 'ECONNABORTED') {
        throw new Error('ChatGPT validation timed out');
      }
      throw new Error(
        `ChatGPT session validation failed: ${err.message || err}`,
      );
    }
  }

  private async refreshAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry) {
      return this.accessToken;
    }
    const info = await ChatGPTSessionService.validateSession(this.sessionToken);
    this.accessToken = info.accessToken;
    // Refresh 5 minutes before expiry
    this.accessTokenExpiry = new Date(info.expires).getTime() - 5 * 60 * 1000;
    return info.accessToken;
  }

  private async applyHumanDelay(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && elapsed < MIN_REQUEST_GAP_MS) {
      await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - elapsed));
    }
    const jitter =
      JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);
    await new Promise((r) => setTimeout(r, jitter));
  }

  private buildPrompt(messages: AIChatMessage[]): string {
    const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const history = messages
      .slice(0, -1)
      .filter((m) => m.role !== 'system')
      .map((m) =>
        m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`,
      )
      .join('\n\n');

    const parts: string[] = [];
    if (systemMsg) parts.push(systemMsg);
    if (history) parts.push(history);
    parts.push(`Human: ${lastMessage.content}`);
    parts.push('Assistant:');
    return parts.join('\n\n');
  }

  async generateResponse(messages: AIChatMessage[]): Promise<string> {
    await this.applyHumanDelay();

    const accessToken = await this.refreshAccessToken();
    const fullPrompt = this.buildPrompt(messages);

    const payload = {
      action: 'next',
      messages: [
        {
          id: randomUUID(),
          author: { role: 'user' },
          content: { content_type: 'text', parts: [fullPrompt] },
        },
      ],
      parent_message_id: randomUUID(),
      model: this.modelName,
      timezone_offset_min: -330,
      suggestions: [],
      history_and_training_disabled: false,
      conversation_mode: { kind: 'primary_assistant' },
      force_paragen: false,
      force_paragen_model_slug: '',
      force_nulligen: false,
      force_rate_limit: false,
    };

    let res;
    try {
      res = await axios.post(
        `${CHATGPT_BASE}/backend-api/conversation`,
        payload,
        {
          headers: {
            ...COMMON_HEADERS,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          timeout: REQUEST_TIMEOUT_MS,
          responseType: 'text',
          transformResponse: [(d) => d],
          validateStatus: () => true,
        },
      );
    } catch (err: any) {
      this.lastRequestAt = Date.now();
      if (err.code === 'ECONNABORTED') {
        throw new Error('ChatGPT request timed out');
      }
      throw err;
    }

    this.lastRequestAt = Date.now();

    if (res.status === 401 || res.status === 403) {
      this.accessToken = null;
      throw new SessionExpiredError();
    }
    if (res.status === 429) {
      throw new RateLimitedError();
    }
    if (res.status >= 400) {
      throw new Error(
        `ChatGPT HTTP ${res.status}: ${String(res.data).slice(0, 200)}`,
      );
    }

    return this.parseSSE(String(res.data));
  }

  private parseSSE(data: string): string {
    const lines = data.split(/\r?\n/);
    let lastContent = '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const part = parsed.message?.content?.parts?.[0];
        if (typeof part === 'string' && part.length > 0) {
          lastContent = part;
        }
      } catch {
        // ignore non-JSON SSE frames
      }
    }
    if (!lastContent) {
      throw new Error('ChatGPT returned empty response');
    }
    return lastContent;
  }
}
