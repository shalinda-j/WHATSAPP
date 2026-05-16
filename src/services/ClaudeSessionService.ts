import axios from 'axios';
import { randomUUID } from 'crypto';
import { AIService, AIChatMessage } from '../interfaces/AIService';

const CLAUDE_BASE = 'https://claude.ai';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: CLAUDE_BASE,
  Referer: `${CLAUDE_BASE}/chats`,
  'Sec-Ch-Ua':
    '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

const MIN_REQUEST_GAP_MS = 3000;
const JITTER_MIN_MS = 500;
const JITTER_MAX_MS = 1500;
// Cap user-facing chat requests at 45s. Previously 120s, which meant a
// stalled provider could block a chat handler for two full minutes —
// long enough that downstream rate-limits and the user's own retry
// timeout would have fired several times.
const REQUEST_TIMEOUT_MS = 45000;

export class ClaudeSessionExpiredError extends Error {
  code = 'SESSION_EXPIRED' as const;
  constructor(message = 'Claude session cookie expired or invalid') {
    super(message);
    this.name = 'ClaudeSessionExpiredError';
  }
}

export class ClaudeRateLimitedError extends Error {
  code = 'RATE_LIMITED' as const;
  constructor(message = 'Claude rate limit hit') {
    super(message);
    this.name = 'ClaudeRateLimitedError';
  }
}

interface ClaudeSessionConfig {
  sessionKey: string;
  organizationId?: string;
  model?: string;
  configId?: string;
  providerType?: string;
}

export interface ClaudeSessionInfo {
  organizationId: string;
  organizationName?: string;
  capabilities?: string[];
}

export class ClaudeSessionService implements AIService {
  name: string;
  configId?: string;
  private sessionKey: string;
  private organizationId: string;
  private modelName: string;
  private lastRequestAt = 0;

  constructor(config: ClaudeSessionConfig) {
    this.sessionKey = config.sessionKey;
    this.organizationId = config.organizationId || '';
    this.modelName = config.model || 'claude-3-5-sonnet-20241022';
    this.configId = config.configId;
    this.name = `Claude-Session (${this.modelName})`;
  }

  static async validateSession(sessionKey: string): Promise<ClaudeSessionInfo> {
    try {
      const res = await axios.get(`${CLAUDE_BASE}/api/organizations`, {
        headers: {
          ...COMMON_HEADERS,
          Accept: 'application/json',
          Cookie: `sessionKey=${sessionKey}`,
        },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (res.status === 401 || res.status === 403) {
        throw new ClaudeSessionExpiredError();
      }
      if (res.status !== 200) {
        throw new Error(`Claude validation failed (HTTP ${res.status})`);
      }

      const orgs = res.data;
      if (!Array.isArray(orgs) || orgs.length === 0) {
        throw new Error('No organizations found for this Claude account');
      }

      // Prefer claude_pro org if multiple
      const preferred =
        orgs.find((o: any) => (o.capabilities || []).includes('claude_pro')) ||
        orgs[0];

      return {
        organizationId: preferred.uuid,
        organizationName: preferred.name,
        capabilities: preferred.capabilities || [],
      };
    } catch (err: any) {
      if (err instanceof ClaudeSessionExpiredError) throw err;
      if (err.code === 'ECONNABORTED') {
        throw new Error('Claude validation timed out');
      }
      throw new Error(
        `Claude session validation failed: ${err.message || err}`,
      );
    }
  }

  private async ensureOrganizationId(): Promise<void> {
    if (this.organizationId) return;
    const info = await ClaudeSessionService.validateSession(this.sessionKey);
    this.organizationId = info.organizationId;
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

  private async createConversation(): Promise<string> {
    const uuid = randomUUID();
    const res = await axios.post(
      `${CLAUDE_BASE}/api/organizations/${this.organizationId}/chat_conversations`,
      { uuid, name: '' },
      {
        headers: {
          ...COMMON_HEADERS,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: `sessionKey=${this.sessionKey}`,
        },
        timeout: 15000,
        validateStatus: () => true,
      },
    );

    if (res.status === 401 || res.status === 403) {
      throw new ClaudeSessionExpiredError();
    }
    if (res.status >= 400) {
      throw new Error(`Claude conversation create failed (HTTP ${res.status})`);
    }
    return res.data?.uuid || uuid;
  }

  private async deleteConversation(conversationId: string): Promise<void> {
    try {
      await axios.delete(
        `${CLAUDE_BASE}/api/organizations/${this.organizationId}/chat_conversations/${conversationId}`,
        {
          headers: {
            ...COMMON_HEADERS,
            Accept: 'application/json',
            Cookie: `sessionKey=${this.sessionKey}`,
          },
          timeout: 10000,
          validateStatus: () => true,
        },
      );
    } catch {
      // best-effort cleanup; ignore failures
    }
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
    await this.ensureOrganizationId();
    await this.applyHumanDelay();

    const conversationId = await this.createConversation();
    const fullPrompt = this.buildPrompt(messages);

    const payload = {
      prompt: fullPrompt,
      model: this.modelName,
      timezone: 'Asia/Colombo',
      attachments: [],
      files: [],
    };

    let res;
    try {
      res = await axios.post(
        `${CLAUDE_BASE}/api/organizations/${this.organizationId}/chat_conversations/${conversationId}/completion`,
        payload,
        {
          headers: {
            ...COMMON_HEADERS,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Cookie: `sessionKey=${this.sessionKey}`,
          },
          timeout: REQUEST_TIMEOUT_MS,
          responseType: 'text',
          transformResponse: [(d) => d],
          validateStatus: () => true,
        },
      );
    } catch (err: any) {
      this.lastRequestAt = Date.now();
      await this.deleteConversation(conversationId);
      if (err.code === 'ECONNABORTED') {
        throw new Error('Claude request timed out');
      }
      throw err;
    }

    this.lastRequestAt = Date.now();

    if (res.status === 401 || res.status === 403) {
      await this.deleteConversation(conversationId);
      throw new ClaudeSessionExpiredError();
    }
    if (res.status === 429) {
      await this.deleteConversation(conversationId);
      throw new ClaudeRateLimitedError();
    }
    if (res.status >= 400) {
      await this.deleteConversation(conversationId);
      throw new Error(
        `Claude HTTP ${res.status}: ${String(res.data).slice(0, 200)}`,
      );
    }

    const response = this.parseSSE(String(res.data));
    // Cleanup conversation after response (keeps Claude UI clean)
    await this.deleteConversation(conversationId);
    return response;
  }

  private parseSSE(data: string): string {
    const lines = data.split(/\r?\n/);
    let response = '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        if (typeof parsed.completion === 'string') {
          response += parsed.completion;
        }
      } catch {
        // ignore non-JSON SSE frames
      }
    }
    if (!response) {
      throw new Error('Claude returned empty response');
    }
    return response;
  }
}
