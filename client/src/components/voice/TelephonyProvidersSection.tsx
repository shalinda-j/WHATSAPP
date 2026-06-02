import { useEffect, useState } from 'react';
import { api } from '../../config';
import {
  PhoneCall,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Send,
  ExternalLink,
} from 'lucide-react';

interface Provider {
  name: string;
  displayName: string;
  requiredEnv: string[];
  supportsLiveCalls: boolean;
  supportsOutbound: boolean;
  readiness: {
    ready: boolean;
    missing: string[];
    notes?: string;
  };
}

interface ListResponse {
  providers: Provider[];
  pinnedEnv: string | null;
}

export default function TelephonyProvidersSection() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pinnedEnv, setPinnedEnv] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Outbound test-call composer
  const [to, setTo] = useState('');
  const [pickedProvider, setPickedProvider] = useState('');
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>('/api/voice-telephony/providers');
      setProviders(res.data.providers);
      setPinnedEnv(res.data.pinnedEnv);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const initiate = async () => {
    if (!to.trim() || calling) return;
    setCalling(true);
    setCallResult(null);
    try {
      const res = await api.post<{
        providerCallId: string;
        status: string;
      }>('/api/voice-telephony/calls/initiate', {
        to: to.trim(),
        provider: pickedProvider || undefined,
      });
      setCallResult(
        `Call queued (${res.data.providerCallId}) — status: ${res.data.status}`,
      );
    } catch (err) {
      const ax = err as {
        response?: { data?: { error?: string; hint?: string } };
      };
      setCallResult(
        ax.response?.data?.hint ||
          ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Call failed'),
      );
    } finally {
      setCalling(false);
    }
  };

  const anyReady = providers.some((p) => p.readiness.ready);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <PhoneCall className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Telephony providers</h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Connect a SIP trunk, Twilio account, or WhatsApp Cloud API to
              enable live voice calls. Without one, the agent stays in voice-
              note reply mode (which now uses your training data + agents).
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="m-4 rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="p-5 space-y-4">
        {loading ? (
          <div className="text-sm text-gray-500">Loading providers…</div>
        ) : (
          <>
            {pinnedEnv && (
              <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-1.5">
                Pinned via env:{' '}
                <code>VOICE_TELEPHONY_PROVIDER={pinnedEnv}</code>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {providers.map((p) => (
                <div
                  key={p.name}
                  className={`rounded-md border p-3 ${
                    p.readiness.ready
                      ? 'border-green-200 bg-green-50/40'
                      : 'border-amber-200 bg-amber-50/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {p.readiness.ready ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                      )}
                      <span className="font-semibold text-gray-900 text-sm truncate">
                        {p.displayName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {p.supportsLiveCalls && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                          live
                        </span>
                      )}
                      {p.supportsOutbound && (
                        <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                          outbound
                        </span>
                      )}
                    </div>
                  </div>
                  {p.readiness.notes && (
                    <p className="text-xs text-gray-600 leading-snug">
                      {p.readiness.notes}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">
                      Env:
                    </span>
                    {p.requiredEnv.map((e) => {
                      const missing = p.readiness.missing.includes(e);
                      return (
                        <code
                          key={e}
                          className={`text-[10px] px-1 py-0.5 rounded font-mono ${
                            missing
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {e}
                        </code>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Outbound test composer */}
            <div className="rounded-md border border-gray-200 p-3 bg-gray-50">
              <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" /> Outbound test call
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="+94771234567 or sip:user@host"
                  className="sm:col-span-2 px-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
                <select
                  value={pickedProvider}
                  onChange={(e) => setPickedProvider(e.target.value)}
                  className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white"
                >
                  <option value="">Auto (first ready)</option>
                  {providers.map((p) => (
                    <option
                      key={p.name}
                      value={p.name}
                      disabled={!p.readiness.ready}
                    >
                      {p.displayName}
                      {!p.readiness.ready ? ' (not ready)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={initiate}
                  disabled={!to.trim() || calling || !anyReady}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
                  title={
                    !anyReady
                      ? 'Configure at least one provider first'
                      : undefined
                  }
                >
                  {calling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PhoneCall className="h-3.5 w-3.5" />
                  )}
                  {calling ? 'Initiating…' : 'Initiate call'}
                </button>
                {callResult && (
                  <span className="text-xs text-gray-700">{callResult}</span>
                )}
              </div>
              {!anyReady && (
                <p className="text-[11px] text-amber-700 mt-2 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Configure at least one provider (set its env vars + restart)
                  to enable live calls.
                </p>
              )}
            </div>

            <p className="text-[11px] text-gray-500 leading-relaxed">
              Bidirectional voice flow uses standard SIP/RTP. Each adapter is
              ready to be wired the moment its credentials are present;
              meanwhile the voice-note reply path uses the same agent
              orchestrator + training data as the chat agents — so every
              training example you add improves both surfaces.
              <a
                href="https://www.twilio.com/console"
                target="_blank"
                rel="noreferrer"
                className="ml-1 text-indigo-600 hover:underline inline-flex items-center gap-0.5"
              >
                Open Twilio console <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
