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

export default function Channels() {
  const [rows, setRows] = useState<ChannelConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Radio className="h-6 w-6 text-green-600" /> Channels
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Connect WhatsApp, Telegram, Instagram, Facebook Messenger and
            Email — one place to manage every messaging surface.
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
            disabled
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-green-600 text-white opacity-50 cursor-not-allowed"
            title="Connection wizard arrives in Phase 1 implementation"
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
            The connection wizard for each platform is delivered in
            Phase 1 of the multi-channel rollout. Until then, the legacy
            WhatsApp session manager continues to handle inbound messages.
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
                      <div className="font-medium text-gray-900">
                        {c.label}
                      </div>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
