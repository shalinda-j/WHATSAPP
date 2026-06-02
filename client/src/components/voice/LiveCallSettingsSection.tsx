import { useEffect, useState } from 'react';
import { api } from '../../config';
import {
  PhoneCall,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Play,
  Save,
  ShieldCheck,
} from 'lucide-react';

/**
 * LiveCallSettingsSection — Admin Panel UI for the WhatsApp live-call feature.
 *
 * Everything the live-call backend needs is managed here: answer mode, the TTS
 * model, the spoken greeting, and the WhatsApp Business Calling API credentials.
 * Secrets are write-only — the API returns only hasApiToken / hasAppSecret, and
 * leaving a secret field blank keeps the stored value unchanged.
 */

interface LiveSettings {
  mode: 'reject-reply' | 'live-answer';
  ttsModel: 'auto' | 'gemini' | 'openai' | 'elevenlabs' | 'google';
  liveGreeting: string;
  defaultLanguage: string;
  phoneNumberId: string;
  webhookVerifyToken: string;
  graphVersion: string;
  hasApiToken: boolean;
  hasAppSecret: boolean;
}

interface LiveStatus {
  mode: string;
  ttsModel: string;
  callingConfigured: boolean;
  mediaAvailable: boolean;
  liveAnswerReady: boolean;
  reason: string | null;
}

const TTS_LABELS: Record<string, string> = {
  auto: 'Auto (use Voice config)',
  gemini: 'Gemini TTS — best Sinhala/Tamil',
  openai: 'OpenAI TTS',
  elevenlabs: 'ElevenLabs (premium)',
  google: 'Google TTS',
};

export default function LiveCallSettingsSection() {
  const [settings, setSettings] = useState<LiveSettings | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Secret inputs are separate so blank = "leave unchanged".
  const [apiToken, setApiToken] = useState('');
  const [appSecret, setAppSecret] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [s, st] = await Promise.all([
        api.get('/api/call-agent/live-settings'),
        api.get('/api/call-agent/live-status').catch(() => ({ data: null })),
      ]);
      setSettings(s.data.settings);
      setStatus(st.data);
    } catch {
      setMsg({ ok: false, text: 'Failed to load live call settings.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 5000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  const patch = (p: Partial<LiveSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...p } : prev));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        mode: settings.mode,
        ttsModel: settings.ttsModel,
        liveGreeting: settings.liveGreeting,
        defaultLanguage: settings.defaultLanguage,
        phoneNumberId: settings.phoneNumberId,
        webhookVerifyToken: settings.webhookVerifyToken,
        graphVersion: settings.graphVersion,
      };
      if (apiToken.trim()) body.apiToken = apiToken.trim();
      if (appSecret.trim()) body.appSecret = appSecret.trim();

      const res = await api.post('/api/call-agent/live-settings', body);
      setSettings(res.data.settings);
      setApiToken('');
      setAppSecret('');
      setMsg({ ok: true, text: 'Live call settings saved.' });
      // Refresh readiness after a save (creds may now be present).
      api
        .get('/api/call-agent/live-status')
        .then((r) => setStatus(r.data))
        .catch(() => undefined);
    } catch {
      setMsg({ ok: false, text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const testTts = async () => {
    if (!settings) return;
    setTesting(true);
    try {
      const res = await api.post('/api/call-agent/test-call-tts', {
        language: settings.defaultLanguage,
        text: settings.liveGreeting,
      });
      const { audio, format } = res.data;
      if (audio) {
        const a = new Audio(`data:audio/${format || 'wav'};base64,${audio}`);
        await a.play();
        setMsg({ ok: true, text: `Played sample via "${res.data.ttsModel}".` });
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: string } } };
      setMsg({
        ok: false,
        text: apiErr?.response?.data?.error || 'TTS test failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading live call settings…
      </div>
    );
  }
  if (!settings) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-indigo-50 rounded-lg">
          <PhoneCall className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Live Call Answering
          </h3>
          <p className="text-sm text-gray-500">
            Manage how incoming WhatsApp calls are handled.
          </p>
        </div>
      </div>

      {/* Readiness banner */}
      {status && (
        <div
          className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
            status.liveAnswerReady
              ? 'bg-green-50 text-green-800'
              : 'bg-amber-50 text-amber-800'
          }`}
        >
          {status.liveAnswerReady ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <div>
            <p className="font-medium">
              {status.liveAnswerReady
                ? 'Live answering is active — calls are picked up and answered with AI voice.'
                : 'Live answering is not active.'}
            </p>
            {status.reason && <p className="opacity-80">{status.reason}</p>}
            <p className="opacity-70 mt-1 text-xs">
              API credentials:{' '}
              {status.callingConfigured ? 'configured' : 'missing'} · WebRTC
              media: {status.mediaAvailable ? 'available' : 'not installed'}
            </p>
          </div>
        </div>
      )}

      {msg && (
        <div
          className={`rounded-lg p-3 text-sm ${
            msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Mode + TTS model */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Answer mode</span>
          <select
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={settings.mode}
            onChange={(e) =>
              patch({ mode: e.target.value as LiveSettings['mode'] })
            }
          >
            <option value="reject-reply">
              Reject + smart reply (text + voice note)
            </option>
            <option value="live-answer">
              Live answer (Business Calling API)
            </option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Call voice (TTS model)
          </span>
          <select
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={settings.ttsModel}
            onChange={(e) =>
              patch({ ttsModel: e.target.value as LiveSettings['ttsModel'] })
            }
          >
            {Object.entries(TTS_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Greeting + language */}
      <div className="grid sm:grid-cols-3 gap-4">
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-gray-700">
            Spoken greeting
          </span>
          <textarea
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={2}
            value={settings.liveGreeting}
            onChange={(e) => patch({ liveGreeting: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Default language
          </span>
          <select
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={settings.defaultLanguage}
            onChange={(e) => patch({ defaultLanguage: e.target.value })}
          >
            <option value="si">Sinhala</option>
            <option value="ta">Tamil</option>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={testTts}
        disabled={testing}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
      >
        {testing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        Test call voice
      </button>

      {/* Business Calling API credentials */}
      <div className="border-t border-gray-100 pt-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-800">
            WhatsApp Business Calling API
          </h4>
        </div>
        <p className="text-xs text-gray-500">
          Required for live answering. Needs a Meta-verified number onboarded to
          the WhatsApp Business Calling API.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Phone number ID
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={settings.phoneNumberId}
              onChange={(e) => patch({ phoneNumberId: e.target.value })}
              placeholder="e.g. 123456789012345"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Graph API version
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={settings.graphVersion}
              onChange={(e) => patch({ graphVersion: e.target.value })}
              placeholder="v21.0"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Access token{' '}
              {settings.hasApiToken && (
                <span className="text-green-600 text-xs">(set)</span>
              )}
            </span>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={
                settings.hasApiToken ? '•••••••• (unchanged)' : 'Enter token'
              }
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              App secret{' '}
              {settings.hasAppSecret && (
                <span className="text-green-600 text-xs">(set)</span>
              )}
            </span>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={
                settings.hasAppSecret
                  ? '•••••••• (unchanged)'
                  : 'Enter app secret'
              }
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-gray-700">
              Webhook verify token
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={settings.webhookVerifyToken}
              onChange={(e) => patch({ webhookVerifyToken: e.target.value })}
              placeholder="Token you set in the Meta App webhook config"
            />
          </label>
        </div>

        <p className="text-xs text-gray-400">
          Webhook URL:{' '}
          <code className="bg-gray-100 px-1 rounded">
            {window.location.origin}/api/webhooks/whatsapp-calling
          </code>{' '}
          — subscribe the <code>calls</code> field in your Meta App.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save settings
        </button>
      </div>
    </div>
  );
}
