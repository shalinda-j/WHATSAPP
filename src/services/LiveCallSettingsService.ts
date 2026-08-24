import Config from '../models/Config';
import { CryptoService } from './CryptoService';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { LiveCallMode, CallTtsModel } from './LiveCallService';
import { META_GRAPH_VERSION } from '../config/meta';

const CONFIG_KEY = 'live_call_settings';
const FALLBACK_PATH = join(process.cwd(), 'data', 'live_call_settings.json');

/**
 * LiveCallSettingsService — single source of truth for everything the live
 * call feature needs, manageable entirely from the Admin Panel.
 *
 * Persistence mirrors VoiceCallAgentService: dual-write to the MongoDB Config
 * collection (key `live_call_settings`) AND a local JSON file, so settings
 * survive restarts and still work when Mongo is briefly unavailable.
 *
 * Secrets (`apiToken`, `appSecret`) are encrypted at rest via CryptoService
 * and never returned raw to the client — the API surfaces only `hasApiToken`
 * / `hasAppSecret` booleans (same contract the channels route uses).
 *
 * Environment variables remain valid as DEFAULTS: if a field has not been set
 * in the panel, the corresponding env var is used. This keeps existing env-
 * based deployments working while making the panel authoritative once saved.
 */

export interface LiveCallSettings {
  /** 'reject-reply' (Baileys default) or 'live-answer' (Business Calling API). */
  mode: LiveCallMode;
  /** TTS engine for the spoken response. */
  ttsModel: CallTtsModel;
  /** Greeting spoken when a call is answered live. */
  liveGreeting: string;
  /** Default language for synthesis when caller language is unknown. */
  defaultLanguage: string;
  /** WhatsApp Business Calling API — WABA phone number id. */
  phoneNumberId: string;
  /** Token echoed on Meta's GET webhook verification handshake. */
  webhookVerifyToken: string;
  /** Graph API version, e.g. 'v25.0'. */
  graphVersion: string;
  /** Encrypted: Business Calling API access token. */
  apiToken: string;
  /** Encrypted: Meta app secret for X-Hub-Signature-256 verification. */
  appSecret: string;
}

/** Shape returned to the client — secrets replaced by presence booleans. */
export interface LiveCallSettingsPublic extends Omit<
  LiveCallSettings,
  'apiToken' | 'appSecret'
> {
  hasApiToken: boolean;
  hasAppSecret: boolean;
}

const SECRET_FIELDS: Array<keyof LiveCallSettings> = ['apiToken', 'appSecret'];

class LiveCallSettingsService {
  private settings: LiveCallSettings | null = null;

  private defaults(): LiveCallSettings {
    return {
      mode:
        (process.env.LIVE_CALL_MODE as LiveCallMode) === 'live-answer'
          ? 'live-answer'
          : 'reject-reply',
      ttsModel: (process.env.CALL_TTS_MODEL as CallTtsModel) || 'auto',
      liveGreeting:
        process.env.CALL_LIVE_GREETING ||
        'ඔබට ආයුබෝවන්! මම ඔබට උදව් කරන්න සූදානම්. කරුණාකර කියන්න.',
      defaultLanguage: process.env.DEFAULT_LANGUAGE || 'si',
      phoneNumberId:
        process.env.WHATSAPP_PHONE_NUMBER_ID ||
        process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ||
        '',
      webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION || META_GRAPH_VERSION,
      apiToken:
        process.env.WHATSAPP_CALLING_API_TOKEN ||
        process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
        '',
      appSecret: process.env.WHATSAPP_APP_SECRET || '',
    };
  }

  /** Load once, then cache. Decrypts secrets into the in-memory copy. */
  async load(): Promise<LiveCallSettings> {
    if (this.settings) return this.settings;

    const base = this.defaults();
    let saved: Partial<LiveCallSettings> | null = null;

    try {
      const config = await Config.findOne({ key: CONFIG_KEY }).lean();
      if ((config as any)?.value) saved = JSON.parse((config as any).value);
    } catch {
      /* Mongo unavailable */
    }
    if (!saved && existsSync(FALLBACK_PATH)) {
      try {
        saved = JSON.parse(readFileSync(FALLBACK_PATH, 'utf-8'));
      } catch {
        /* corrupt file */
      }
    }

    const merged: LiveCallSettings = { ...base, ...(saved || {}) };
    // Decrypt secrets that were stored encrypted.
    for (const f of SECRET_FIELDS) {
      const v = merged[f];
      if (v) merged[f] = (CryptoService.decrypt(v) ?? base[f]) as never;
    }
    this.settings = merged;
    return this.settings;
  }

  /** Force a re-read on next access (after external mutation). */
  invalidate(): void {
    this.settings = null;
  }

  /**
   * Update settings from the panel. Secret fields are only overwritten when a
   * non-empty value is supplied (empty string = "leave unchanged"), so saving
   * the form without re-typing a token never wipes it.
   */
  async update(patch: Partial<LiveCallSettings>): Promise<LiveCallSettings> {
    const current = await this.load();
    const next: LiveCallSettings = { ...current };

    for (const [key, value] of Object.entries(patch) as Array<
      [keyof LiveCallSettings, LiveCallSettings[keyof LiveCallSettings]]
    >) {
      if (value === undefined) continue;
      if (SECRET_FIELDS.includes(key) && (value === '' || value == null)) {
        continue; // keep existing secret
      }
      next[key] = value as never;
    }

    this.settings = next;
    await this.persist(next);
    return next;
  }

  private async persist(s: LiveCallSettings): Promise<void> {
    // Encrypt secrets before writing anywhere.
    const onDisk: LiveCallSettings = { ...s };
    for (const f of SECRET_FIELDS) {
      const v = onDisk[f];
      onDisk[f] = (v ? CryptoService.encrypt(v) : v) as never;
    }
    const value = JSON.stringify(onDisk);

    try {
      await Config.findOneAndUpdate(
        { key: CONFIG_KEY },
        { key: CONFIG_KEY, value, description: 'Live Call Settings' },
        { upsert: true, new: true },
      );
    } catch {
      /* Mongo unavailable — file fallback below */
    }
    try {
      const { mkdirSync } = await import('fs');
      const { dirname } = await import('path');
      mkdirSync(dirname(FALLBACK_PATH), { recursive: true });
      writeFileSync(FALLBACK_PATH, value, 'utf-8');
    } catch (err) {
      console.error('Failed to persist live call settings to file:', err);
    }
  }

  /** Client-safe view: secrets replaced by presence booleans. */
  async getPublic(): Promise<LiveCallSettingsPublic> {
    const s = await this.load();
    const { apiToken, appSecret, ...rest } = s;
    return {
      ...rest,
      hasApiToken: Boolean(apiToken),
      hasAppSecret: Boolean(appSecret),
    };
  }

  // ── Resolved getters used by the runtime (decrypted, env-fallback) ────────
  async getMode(): Promise<LiveCallMode> {
    return (await this.load()).mode;
  }
  async getTtsModel(): Promise<CallTtsModel> {
    return (await this.load()).ttsModel;
  }
  async getLiveGreeting(): Promise<string> {
    return (await this.load()).liveGreeting;
  }
  async getDefaultLanguage(): Promise<string> {
    return (await this.load()).defaultLanguage;
  }
  async getApiToken(): Promise<string> {
    return (await this.load()).apiToken;
  }
  async getPhoneNumberId(): Promise<string> {
    return (await this.load()).phoneNumberId;
  }
  async getAppSecret(): Promise<string> {
    return (await this.load()).appSecret;
  }
  async getWebhookVerifyToken(): Promise<string> {
    return (await this.load()).webhookVerifyToken;
  }
  async getGraphVersion(): Promise<string> {
    return (await this.load()).graphVersion;
  }

  /** True when both API credentials are present (live-answer prerequisite). */
  async isCallingConfigured(): Promise<boolean> {
    const s = await this.load();
    return Boolean(s.apiToken && s.phoneNumberId);
  }
}

export const liveCallSettings = new LiveCallSettingsService();
