/**
 * Real-API integration executors for the workflow engine.
 *
 * The workflow builder lets operators drag "integration" nodes onto the
 * canvas (FB Pages, Telegram, WhatsApp, Buffer, etc.) and configure each
 * one with credentials + payload. Previously the executor logged the
 * intent but never made the HTTP call. This module wires every supported
 * provider to its real API, with:
 *
 *   - Per-provider input validation (so a missing token fails loudly
 *     during a test-run instead of silently 401-ing at the provider).
 *   - Bounded timeouts (axios `timeout: 20s` + a Promise.race hard cap
 *     of 30s) so a stalled provider can never hold the workflow forever.
 *   - Structured ExecutorResult with `ok` / `status` / `provider-side
 *     id` / readable error so the per-node log is useful for debugging.
 *
 * Unknown integration types degrade to a "logged-only" stub that
 * doesn't pretend success — keeps the framework safe to extend.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { channelRouter } from '../../channels';
import type { Channel } from '../../types/agent';
import type { OutboundMessage } from '../../channels/types';

export interface ExecutorContext {
  /** Tenant the workflow is running in — used to resolve channel adapters. */
  tenantId?: string;
  /** Triggering payload from the workflow start node + upstream outputs. */
  triggerData: unknown;
  /** Outputs from every previously-executed node, keyed by node id. */
  upstream: Record<string, unknown>;
}

export interface ExecutorResult {
  ok: boolean;
  status?: number;
  providerCallId?: string;
  /** Anything the downstream nodes might want to reference. */
  data?: unknown;
  /** Readable error when ok=false. */
  error?: string;
}

/**
 * Shape of an integration node's `node.data`. Strict at the executor
 * boundary so a typo in the config UI is caught fast. We keep the type
 * loose for unknown fields since each provider has its own quirks.
 */
export interface IntegrationNodeConfig {
  integrationType?: string;
  // common payload fields surfaced by the UI:
  message?: string;
  text?: string;
  to?: string;
  subject?: string;
  url?: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  // common credential fields surfaced by the UI:
  accessToken?: string;
  apiKey?: string;
  // provider-specific fields (loose-typed):
  [k: string]: unknown;
}

type Executor = (
  cfg: IntegrationNodeConfig,
  ctx: ExecutorContext,
) => Promise<ExecutorResult>;

const HARD_DEADLINE_MS = 30_000;

/**
 * Wrap a provider call so axios.timeout (read-timeout only) can't stall the
 * workflow during a slow connect/DNS phase. 30s is well above any normal
 * provider latency.
 */
async function withHardDeadline<T>(
  label: string,
  p: Promise<T>,
): Promise<T> {
  let to: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    to = setTimeout(
      () => reject(new Error(`${label} exceeded ${HARD_DEADLINE_MS}ms`)),
      HARD_DEADLINE_MS,
    );
    to.unref?.();
  });
  try {
    return await Promise.race([p, deadline]);
  } finally {
    // @ts-expect-error — clear in any branch
    clearTimeout(to);
  }
}

function readableAxiosError(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax = err as any;
  const status = ax?.response?.status;
  const data = ax?.response?.data;
  if (status) {
    const detail =
      typeof data === 'string'
        ? data.slice(0, 200)
        : data?.error?.message ?? data?.message ?? JSON.stringify(data ?? {}).slice(0, 200);
    return `HTTP ${status}: ${detail}`;
  }
  return err instanceof Error ? err.message : 'Unknown provider error';
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel-adapter-backed executors (reuse the live ChannelRouter so the
// workflow engine inherits the same rate limits + tenant scoping that the
// chat path already enforces).
// ─────────────────────────────────────────────────────────────────────────────

const sendViaChannel =
  (channelName: Channel): Executor =>
  async (cfg, ctx) => {
    const recipient = String(cfg.to ?? '').trim();
    const text = String(cfg.message ?? cfg.text ?? '').trim();
    if (!recipient) {
      return { ok: false, error: '"to" recipient is required' };
    }
    if (!text) return { ok: false, error: '"message" or "text" is required' };
    if (!ctx.tenantId) {
      return { ok: false, error: 'workflow tenantId is required' };
    }
    const adapter = channelRouter.get(channelName);
    if (!adapter) {
      return {
        ok: false,
        error: `${channelName} channel adapter is not registered`,
      };
    }
    const outbound: OutboundMessage = {
      channel: channelName,
      tenantId: ctx.tenantId,
      recipient,
      text,
      ...(cfg.subject ? { metadata: { subject: String(cfg.subject) } } : {}),
    };
    try {
      const sendResult = await withHardDeadline(
        `${channelName}.send`,
        adapter.send(outbound),
      );
      return {
        ok: sendResult.ok,
        providerCallId: sendResult.externalMessageId,
        data: sendResult,
        error: sendResult.ok ? undefined : sendResult.error,
      };
    } catch (err) {
      return { ok: false, error: readableAxiosError(err) };
    }
  };

// ─────────────────────────────────────────────────────────────────────────────
// HTTP-based executors for the Social Graph + Buffer-style APIs. Each
// validates the minimum field set and reports a readable error otherwise.
// ─────────────────────────────────────────────────────────────────────────────

const facebookPagePost: Executor = async (cfg) => {
  const pageId = String(cfg.pageId ?? '').trim();
  const accessToken = String(cfg.accessToken ?? '').trim();
  const message = String(cfg.message ?? cfg.text ?? '').trim();
  if (!pageId) return { ok: false, error: '"pageId" is required' };
  if (!accessToken) return { ok: false, error: '"accessToken" is required' };
  if (!message) return { ok: false, error: '"message" is required' };
  try {
    const res = await withHardDeadline(
      'facebook_pages',
      axios.post(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`,
        { message, access_token: accessToken },
        { timeout: 20000 },
      ),
    );
    return {
      ok: true,
      status: res.status,
      providerCallId: res.data?.id,
      data: res.data,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

const instagramBusinessPost: Executor = async (cfg) => {
  const igUserId = String(
    cfg.businessAccountId ?? cfg.igUserId ?? '',
  ).trim();
  const accessToken = String(cfg.accessToken ?? '').trim();
  const imageUrl = String(cfg.imageUrl ?? cfg.mediaUrl ?? '').trim();
  const caption = String(cfg.caption ?? cfg.message ?? cfg.text ?? '').trim();
  if (!igUserId)
    return { ok: false, error: '"businessAccountId" is required' };
  if (!accessToken) return { ok: false, error: '"accessToken" is required' };
  if (!imageUrl)
    return { ok: false, error: '"imageUrl" is required (publicly reachable)' };
  try {
    // Two-step Instagram publishing: container then publish.
    const containerRes = await withHardDeadline(
      'instagram_business.container',
      axios.post(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media`,
        {
          image_url: imageUrl,
          caption,
          access_token: accessToken,
        },
        { timeout: 20000 },
      ),
    );
    const containerId = containerRes.data?.id;
    if (!containerId) {
      return { ok: false, error: 'No container id returned from Instagram' };
    }
    const publishRes = await withHardDeadline(
      'instagram_business.publish',
      axios.post(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media_publish`,
        { creation_id: containerId, access_token: accessToken },
        { timeout: 20000 },
      ),
    );
    return {
      ok: true,
      status: publishRes.status,
      providerCallId: publishRes.data?.id,
      data: publishRes.data,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

const linkedinPost: Executor = async (cfg) => {
  const orgId = String(cfg.organizationId ?? '').trim();
  const accessToken = String(cfg.accessToken ?? '').trim();
  const text = String(cfg.message ?? cfg.text ?? '').trim();
  if (!orgId) return { ok: false, error: '"organizationId" is required' };
  if (!accessToken) return { ok: false, error: '"accessToken" is required' };
  if (!text) return { ok: false, error: '"message" is required' };
  try {
    const res = await withHardDeadline(
      'linkedin_company',
      axios.post(
        'https://api.linkedin.com/v2/ugcPosts',
        {
          author: `urn:li:organization:${orgId}`,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text },
              shareMediaCategory: 'NONE',
            },
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      ),
    );
    return {
      ok: true,
      status: res.status,
      providerCallId: res.data?.id,
      data: res.data,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

const twitterTweet: Executor = async (cfg) => {
  // Twitter/X API v2 — uses OAuth 2.0 bearer for app-only or user-context.
  // We accept either `accessToken` (bearer) or `apiKey` (legacy alias).
  const bearer = String(cfg.accessToken ?? cfg.apiKey ?? '').trim();
  const text = String(cfg.message ?? cfg.text ?? '').trim();
  if (!bearer) return { ok: false, error: '"accessToken" is required' };
  if (!text) return { ok: false, error: '"message" is required' };
  try {
    const res = await withHardDeadline(
      'twitter',
      axios.post(
        'https://api.twitter.com/2/tweets',
        { text },
        {
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      ),
    );
    return {
      ok: true,
      status: res.status,
      providerCallId: res.data?.data?.id,
      data: res.data,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

const bufferQueue: Executor = async (cfg) => {
  const accessToken = String(cfg.accessToken ?? '').trim();
  const profileId = String(cfg.profileId ?? '').trim();
  const text = String(cfg.message ?? cfg.text ?? '').trim();
  if (!accessToken) return { ok: false, error: '"accessToken" is required' };
  if (!profileId) return { ok: false, error: '"profileId" is required' };
  if (!text) return { ok: false, error: '"message" is required' };
  try {
    const params = new URLSearchParams();
    params.append('text', text);
    params.append('profile_ids[]', profileId);
    params.append('access_token', accessToken);
    const res = await withHardDeadline(
      'buffer',
      axios.post(
        'https://api.bufferapp.com/1/updates/create.json',
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 20000,
        },
      ),
    );
    return {
      ok: true,
      status: res.status,
      data: res.data,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

const tiktokPublish: Executor = async (cfg) => {
  const accessToken = String(cfg.accessToken ?? '').trim();
  const videoUrl = String(cfg.videoUrl ?? '').trim();
  if (!accessToken) return { ok: false, error: '"accessToken" is required' };
  if (!videoUrl) return { ok: false, error: '"videoUrl" is required' };
  try {
    // TikTok content posting API — the published flow is multi-step; this
    // kicks off the upload by URL. Operators who need full chunked upload
    // should swap in a richer executor.
    const res = await withHardDeadline(
      'tiktok_publish',
      axios.post(
        'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
        {
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      ),
    );
    return {
      ok: true,
      status: res.status,
      providerCallId: res.data?.data?.publish_id,
      data: res.data,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

const telegramBotSend: Executor = async (cfg) => {
  const botToken = String(cfg.botToken ?? '').trim();
  const chatId = String(cfg.chatId ?? cfg.to ?? '').trim();
  const text = String(cfg.message ?? cfg.text ?? '').trim();
  if (!botToken) return { ok: false, error: '"botToken" is required' };
  if (!chatId) return { ok: false, error: '"chatId" is required' };
  if (!text) return { ok: false, error: '"message" is required' };
  try {
    const res = await withHardDeadline(
      'telegram_bot',
      axios.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        { chat_id: chatId, text },
        { timeout: 20000 },
      ),
    );
    return {
      ok: true,
      status: res.status,
      providerCallId: res.data?.result?.message_id?.toString(),
      data: res.data,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

const whatsappCloudSend: Executor = async (cfg) => {
  const phoneNumberId = String(cfg.phoneNumberId ?? '').trim();
  const accessToken = String(cfg.accessToken ?? '').trim();
  const to = String(cfg.to ?? '').trim();
  const text = String(cfg.message ?? cfg.text ?? '').trim();
  if (!phoneNumberId)
    return { ok: false, error: '"phoneNumberId" is required' };
  if (!accessToken) return { ok: false, error: '"accessToken" is required' };
  if (!to) return { ok: false, error: '"to" is required (E.164 number)' };
  if (!text) return { ok: false, error: '"message" is required' };
  try {
    const res = await withHardDeadline(
      'whatsapp_business',
      axios.post(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      ),
    );
    return {
      ok: true,
      status: res.status,
      providerCallId: res.data?.messages?.[0]?.id,
      data: res.data,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

const sendgridEmail: Executor = async (cfg) => {
  const apiKey = String(cfg.apiKey ?? '').trim();
  const to = String(cfg.to ?? '').trim();
  const fromAddress = String(cfg.from ?? cfg.fromAddress ?? '').trim();
  const subject = String(cfg.subject ?? '').trim() || '(no subject)';
  const body = String(cfg.message ?? cfg.text ?? '').trim();
  if (!apiKey) return { ok: false, error: '"apiKey" is required' };
  if (!to) return { ok: false, error: '"to" is required' };
  if (!fromAddress) return { ok: false, error: '"from" is required' };
  if (!body) return { ok: false, error: '"message" is required' };
  try {
    const res = await withHardDeadline(
      'sendgrid',
      axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          personalizations: [{ to: [{ email: to }] }],
          from: { email: fromAddress },
          subject,
          content: [{ type: 'text/plain', value: body }],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      ),
    );
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

/**
 * Generic HTTP node — operator provides url, method, body, headers.
 * Lets any provider with a webhook be one drag-drop away even without a
 * dedicated executor.
 */
const genericHttp: Executor = async (cfg) => {
  const url = String(cfg.url ?? '').trim();
  const method = String(cfg.method ?? 'POST').toUpperCase();
  if (!url) return { ok: false, error: '"url" is required' };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'url must start with http:// or https://' };
  }
  const opts: AxiosRequestConfig = {
    method: method as AxiosRequestConfig['method'],
    url,
    headers: cfg.headers ?? {},
    timeout: 20000,
    validateStatus: () => true, // never throw on status — surface it instead
  };
  if (cfg.body != null && method !== 'GET' && method !== 'HEAD') {
    opts.data = cfg.body;
  }
  try {
    const res = await withHardDeadline('generic_http', axios(opts));
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      data: res.data,
      error:
        res.status >= 400
          ? `HTTP ${res.status}: ${
              typeof res.data === 'string'
                ? res.data.slice(0, 200)
                : JSON.stringify(res.data ?? {}).slice(0, 200)
            }`
          : undefined,
    };
  } catch (err) {
    return { ok: false, error: readableAxiosError(err) };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Registry — maps the integration `id` shown in the UI palette to its
// executor. Anything not in this map falls through to the legacy "logged
// only" stub so unsupported providers visibly fail rather than fake success.
// ─────────────────────────────────────────────────────────────────────────────

export const INTEGRATION_EXECUTORS: Record<string, Executor> = {
  // Internal channels (reuse the live ChannelRouter):
  whatsapp: sendViaChannel('whatsapp'),
  telegram: sendViaChannel('telegram'),
  email: sendViaChannel('email'),
  // HTTP-based providers:
  facebook_pages: facebookPagePost,
  instagram_business: instagramBusinessPost,
  linkedin_company: linkedinPost,
  twitter: twitterTweet,
  buffer: bufferQueue,
  tiktok_publish: tiktokPublish,
  telegram_bot: telegramBotSend,
  whatsapp_business: whatsappCloudSend,
  sendgrid: sendgridEmail,
  generic_http: genericHttp,
};

export function getIntegrationExecutor(name?: string): Executor | null {
  if (!name) return null;
  return INTEGRATION_EXECUTORS[name] ?? null;
}
