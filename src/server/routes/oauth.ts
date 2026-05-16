/**
 * OAuth scaffolding for one-click social-media account connection.
 *
 * Each supported provider declares its endpoints, scopes and the env vars
 * that hold its app credentials. Routes are safe to mount without any
 * credentials configured — they return a structured 503 explaining what's
 * missing instead of crashing the server.
 *
 * Flow:
 *   GET  /api/auth/oauth/:provider/start    → 302 redirect to provider
 *   GET  /api/auth/oauth/:provider/callback → token exchange → ChannelConnection
 *
 * Operator credentials needed before each provider goes live (Phase 0 of the
 * platform plan): see README setup section / Channels page tile copy.
 */

import { Router, Request, Response } from 'express';
import { randomBytes, createHmac } from 'crypto';
import axios from 'axios';
import ChannelConnection from '../../models/ChannelConnection';
import Tenant from '../../models/Tenant';
import { resolveTenant } from '../middleware/tenantContext';
import { Channel } from '../../types/agent';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Provider registry
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderConfig {
  channel: Channel;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Returned label is used as the ChannelConnection.label fallback. */
  defaultLabel: string;
  /**
   * Maps the raw provider token-exchange JSON onto the
   * ChannelConnection.credentials + .config shape the rest of the app expects.
   * Keep field names matching the manual-paste flow so adapters stay generic.
   */
  shape: (tokenResponse: Record<string, unknown>) => {
    credentials: Record<string, string>;
    config: Record<string, unknown>;
  };
}

const PROVIDERS: Record<string, ProviderConfig> = {
  facebook: {
    channel: 'facebook',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: ['pages_messaging', 'pages_show_list', 'pages_manage_metadata'],
    clientIdEnv: 'FB_APP_ID',
    clientSecretEnv: 'FB_APP_SECRET',
    defaultLabel: 'Facebook page',
    shape: (t) => ({
      credentials: { accessToken: String(t.access_token ?? '') },
      config: {
        expiresIn: t.expires_in ?? null,
        tokenType: t.token_type ?? 'bearer',
      },
    }),
  },
  instagram: {
    channel: 'instagram',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: [
      'instagram_basic',
      'instagram_manage_messages',
      'pages_show_list',
    ],
    clientIdEnv: 'FB_APP_ID',
    clientSecretEnv: 'FB_APP_SECRET',
    defaultLabel: 'Instagram account',
    shape: (t) => ({
      credentials: { accessToken: String(t.access_token ?? '') },
      config: {
        expiresIn: t.expires_in ?? null,
        tokenType: t.token_type ?? 'bearer',
      },
    }),
  },
  linkedin: {
    channel: 'linkedin',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['w_member_social', 'r_liteprofile', 'r_organization_social'],
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    defaultLabel: 'LinkedIn account',
    shape: (t) => ({
      credentials: {
        accessToken: String(t.access_token ?? ''),
        refreshToken: String(t.refresh_token ?? ''),
      },
      config: {
        expiresIn: t.expires_in ?? null,
        scope: t.scope ?? null,
      },
    }),
  },
  tiktok: {
    channel: 'tiktok',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    defaultLabel: 'TikTok account',
    shape: (t) => ({
      credentials: {
        accessToken: String(t.access_token ?? ''),
        refreshToken: String(t.refresh_token ?? ''),
      },
      config: {
        openId: t.open_id ?? null,
        expiresIn: t.expires_in ?? null,
        refreshExpiresIn: t.refresh_expires_in ?? null,
        scope: t.scope ?? null,
      },
    }),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// State helpers — CSRF-resistant signed state, no extra Mongo collection.
// State payload encodes the tenantId so the callback runs in the right scope
// even though the user is mid-redirect and outside our session cookie.
// ─────────────────────────────────────────────────────────────────────────────

interface StatePayload {
  tenantId: string;
  provider: string;
  nonce: string;
  ts: number;
}

const STATE_SECRET = (): string =>
  process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || 'dev-only-state-secret';

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function signState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', STATE_SECRET()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(state: string): StatePayload | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', STATE_SECRET()).update(body).digest('base64url');
  if (expected !== sig) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as StatePayload;
    if (Date.now() - parsed.ts > STATE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getRedirectUri(req: Request, provider: string): string {
  const base =
    process.env.OAUTH_REDIRECT_BASE ||
    `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/oauth/${provider}/callback`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/auth/oauth/providers
 * Lists which providers are wired and which are missing credentials. Useful
 * for the Channels UI to grey out tiles that aren't ready yet.
 */
router.get('/providers', (_req: Request, res: Response) => {
  const out = Object.entries(PROVIDERS).map(([key, p]) => ({
    provider: key,
    channel: p.channel,
    ready:
      !!process.env[p.clientIdEnv] && !!process.env[p.clientSecretEnv],
    missing: [
      ...(process.env[p.clientIdEnv] ? [] : [p.clientIdEnv]),
      ...(process.env[p.clientSecretEnv] ? [] : [p.clientSecretEnv]),
    ],
  }));
  res.json({ providers: out });
});

router.use(resolveTenant);

/**
 * GET /api/auth/oauth/:provider/start
 * Builds the provider authorize URL and 302s. The operator must already be
 * signed in (resolveTenant pulls tenantId from the session/JWT).
 */
router.get(
  '/:provider/start',
  async (req: Request<{ provider: string }>, res: Response) => {
    const cfg = PROVIDERS[req.params.provider];
    if (!cfg) return res.status(404).json({ error: 'unknown_provider' });

    const clientId = process.env[cfg.clientIdEnv];
    const clientSecret = process.env[cfg.clientSecretEnv];
    if (!clientId || !clientSecret) {
      return res.status(503).json({
        error: 'provider_not_configured',
        missing: [
          ...(clientId ? [] : [cfg.clientIdEnv]),
          ...(clientSecret ? [] : [cfg.clientSecretEnv]),
        ],
        hint: `Set ${cfg.clientIdEnv} and ${cfg.clientSecretEnv} in the server environment.`,
      });
    }

    const tenantId = req.tenant?._id;
    if (!tenantId) return res.status(401).json({ error: 'no_tenant' });

    const state = signState({
      tenantId: String(tenantId),
      provider: req.params.provider,
      nonce: randomBytes(12).toString('hex'),
      ts: Date.now(),
    });

    const url = new URL(cfg.authorizeUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', getRedirectUri(req, req.params.provider));
    url.searchParams.set('scope', cfg.scopes.join(','));
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');

    res.redirect(url.toString());
  },
);

/**
 * GET /api/auth/oauth/:provider/callback
 * Exchanges the auth code for tokens and inserts a ChannelConnection row.
 * Redirects the operator back to /channels?connected=<provider>.
 */
router.get(
  '/:provider/callback',
  async (
    req: Request<{ provider: string }, unknown, unknown, { code?: string; state?: string; error?: string }>,
    res: Response,
  ) => {
    const cfg = PROVIDERS[req.params.provider];
    if (!cfg) return res.status(404).json({ error: 'unknown_provider' });

    if (req.query.error) {
      return res.redirect(
        `/channels?oauth=failed&provider=${req.params.provider}&reason=${encodeURIComponent(String(req.query.error))}`,
      );
    }

    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: 'missing_params' });

    const payload = verifyState(String(state));
    if (!payload || payload.provider !== req.params.provider) {
      return res.status(400).json({ error: 'invalid_state' });
    }

    const tenant = await Tenant.findById(payload.tenantId);
    if (!tenant) return res.status(401).json({ error: 'tenant_not_found' });

    const clientId = process.env[cfg.clientIdEnv]!;
    const clientSecret = process.env[cfg.clientSecretEnv]!;

    try {
      const tokenResponse = await axios.post(
        cfg.tokenUrl,
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: getRedirectUri(req, req.params.provider),
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 15000,
        },
      );

      const shaped = cfg.shape(tokenResponse.data ?? {});
      if (!shaped.credentials.accessToken) {
        return res.status(502).json({
          error: 'token_exchange_failed',
          detail: 'No access_token in provider response',
        });
      }

      const conn = await ChannelConnection.create({
        tenantId: tenant._id,
        channel: cfg.channel,
        label: cfg.defaultLabel,
        credentials: shaped.credentials,
        config: shaped.config,
        status: 'active',
        lastConnectedAt: new Date(),
      });

      // The operator can re-label and pick a sub-account (e.g. specific FB
      // Page) from /channels — we drop them there.
      return res.redirect(
        `/channels?oauth=success&provider=${req.params.provider}&id=${conn._id}`,
      );
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: unknown } } };
      const detail =
        ax?.response?.data?.error ??
        (err instanceof Error ? err.message : 'unknown_error');
      console.error(`OAuth ${req.params.provider} callback failed:`, detail);
      return res.redirect(
        `/channels?oauth=failed&provider=${req.params.provider}&reason=${encodeURIComponent(JSON.stringify(detail))}`,
      );
    }
  },
);

export default router;
