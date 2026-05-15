import { useEffect, useState } from 'react';
import { api } from '../config';
import {
  Radio,
  MessageCircle,
  Send,
  Instagram,
  Facebook,
  Mail,
  RefreshCw,
  Plus,
  X,
  Trash2,
} from 'lucide-react';

type Channel =
  | 'whatsapp'
  | 'telegram'
  | 'instagram'
  | 'facebook'
  | 'email'
  | 'linkedin'
  | 'tiktok'
  | 'twitter'
  | 'youtube'
  | 'web';

interface ChannelConnectionRow {
  _id: string;
  channel: Channel;
  label: string;
  status: 'pending' | 'active' | 'failed' | 'disconnected';
  lastError?: string;
  lastConnectedAt?: string;
  hasCredentials: boolean;
  config: Record<string, unknown>;
}

const CHANNEL_META: Record<
  Channel,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  whatsapp: { icon: MessageCircle, color: 'text-green-600' },
  telegram: { icon: Send, color: 'text-blue-500' },
  instagram: { icon: Instagram, color: 'text-pink-600' },
  facebook: { icon: Facebook, color: 'text-blue-700' },
  email: { icon: Mail, color: 'text-gray-600' },
  linkedin: { icon: Radio, color: 'text-blue-800' },
  tiktok: { icon: Radio, color: 'text-black' },
  twitter: { icon: Radio, color: 'text-sky-500' },
  youtube: { icon: Radio, color: 'text-red-600' },
  web: { icon: Radio, color: 'text-gray-700' },
};

const STATUS_BADGE = {
  active: 'bg-green-100 text-green-700 ring-1 ring-green-200',
  pending: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  failed: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  disconnected: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
};

// Per-channel credential field definitions. Drives the Connect wizard.
const CREDENTIAL_FIELDS: Partial<
  Record<
    Channel,
    Array<{ key: string; label: string; type: 'text' | 'password' }>
  >
> = {
  telegram: [
    { key: 'botToken', label: 'Bot Token (BotFather)', type: 'password' },
  ],
  email: [
    { key: 'provider', label: 'Provider (sendgrid|ses|smtp)', type: 'text' },
    { key: 'apiKey', label: 'API Key', type: 'password' },
    { key: 'fromAddress', label: 'From address', type: 'text' },
  ],
  instagram: [
    { key: 'businessAccountId', label: 'Business Account ID', type: 'text' },
    { key: 'accessToken', label: 'Page Access Token', type: 'password' },
  ],
  facebook: [
    { key: 'pageId', label: 'Page ID', type: 'text' },
    { key: 'accessToken', label: 'Page Access Token', type: 'password' },
  ],
};

const CONNECTABLE_CHANNELS: Channel[] = [
  'telegram',
  'instagram',
  'facebook',
  'email',
];

export default function Channels() {
  const [rows, setRows] = useState<ChannelConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Connect wizard state
  const [showConnect, setShowConnect] = useState(false);
  const [pickChannel, setPickChannel] = useState<Channel>('telegram');
  const [label, setLabel] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ChannelConnectionRow[]>('/api/channels');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const testConnection = async (id: string) => {
    try {
      await api.post(`/api/channels/${id}/test`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Test failed');
    }
  };

  const removeConnection = async (id: string, lbl: string) => {
    if (!window.confirm(`Remove channel "${lbl}"?`)) return;
    try {
      await api.delete(`/api/channels/${id}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const openConnect = () => {
    setShowConnect(true);
    setPickChannel('telegram');
    setLabel('');
    setCreds({});
    setSaveError(null);
  };

  const saveConnection = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.post('/api/channels', {
        channel: pickChannel,
        label: label || `My ${pickChannel}`,
        credentials: creds,
        config: {},
      });
      setShowConnect(false);
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setSaveError(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Save failed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const fields = CREDENTIAL_FIELDS[pickChannel] ?? [];

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Radio className="h-6 w-6 text-green-600" /> Channels
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Connect WhatsApp, Telegram, Instagram, Facebook Messenger and Email
            — one place to manage every messaging surface.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-gray-200 bg-white hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={openConnect}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-green-600 text-white hover:bg-green-700"
          >
            <Plus className="h-4 w-4" /> Connect channel
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-gray-700 font-medium">No channels connected yet</p>
          <p className="text-sm text-gray-500 mt-1">
            WhatsApp is wired by default via the QR-code session manager. Click{' '}
            <strong>Connect channel</strong> to add Telegram, Instagram,
            Facebook Messenger or Email.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((c) => {
            const Meta = CHANNEL_META[c.channel] ?? CHANNEL_META.web;
            const Icon = Meta.icon;
            return (
              <div
                key={c._id}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${Meta.color}`} />
                    <div>
                      <div className="font-medium text-gray-900">{c.label}</div>
                      <div className="text-xs text-gray-500 capitalize">
                        {c.channel}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[c.status]}`}
                  >
                    {c.status}
                  </span>
                </div>
                {c.lastError && (
                  <p className="mt-2 text-xs text-red-600">{c.lastError}</p>
                )}
                <div className="mt-3 flex items-center justify-end gap-3">
                  <button
                    onClick={() => testConnection(c._id)}
                    className="text-xs text-gray-600 hover:text-gray-900"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => removeConnection(c._id, c.label)}
                    className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showConnect && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Plus className="h-5 w-5 text-green-600" /> Connect a channel
              </h3>
              <button
                onClick={() => setShowConnect(false)}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Channel
                </label>
                <select
                  value={pickChannel}
                  onChange={(e) => {
                    setPickChannel(e.target.value as Channel);
                    setCreds({});
                  }}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-white"
                >
                  {CONNECTABLE_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {ch}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  WhatsApp connects automatically via the QR-code session
                  manager on the Linked Devices page.
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Label
                </label>
                <input
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={`My ${pickChannel}`}
                />
              </div>
              {fields.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No credential fields registered for this channel. Save to
                  create a stub connection.
                </p>
              ) : (
                fields.map((f) => (
                  <div key={f.key}>
                    <label className="text-xs text-gray-600 mb-1 block">
                      {f.label}
                    </label>
                    <input
                      type={f.type}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                      value={creds[f.key] ?? ''}
                      onChange={(e) =>
                        setCreds({ ...creds, [f.key]: e.target.value })
                      }
                      autoComplete="off"
                    />
                  </div>
                ))
              )}
              {saveError && (
                <div className="rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-xs">
                  {saveError}
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowConnect(false)}
                className="px-3 py-1.5 rounded-md text-sm border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveConnection}
                disabled={saving}
                className="px-3 py-1.5 rounded-md text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
