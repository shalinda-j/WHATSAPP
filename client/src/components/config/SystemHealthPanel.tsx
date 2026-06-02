import { useEffect, useState } from 'react';
import { api } from '../../config';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Wand2,
  PhoneCall,
  Cpu,
  RefreshCw,
  XCircle,
} from 'lucide-react';

interface ProbeResult {
  ok: boolean;
  status: number | null;
  message?: string;
  detail?: unknown;
}

interface Probe {
  key: string;
  label: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}

const PROBES: Probe[] = [
  {
    key: 'health',
    label: 'Backend health',
    url: '/health',
    icon: Activity,
    hint: 'Express process responding.',
  },
  {
    key: 'content_providers',
    label: 'Content gen (image)',
    url: '/api/content/providers',
    icon: Wand2,
    hint: 'OpenAI / Stability image providers. Failure usually means the route or the imported provider SDK crashed.',
  },
  {
    key: 'voice_providers',
    label: 'Voice telephony providers',
    url: '/api/voice-telephony/providers',
    icon: PhoneCall,
    hint: 'Twilio / SLT-Mobitel / Dialog / Hutch / Generic SIP / WhatsApp Cloud.',
  },
  {
    key: 'agents',
    label: 'Agents registry',
    url: '/api/agents',
    icon: Cpu,
    hint: 'Agent configs + today usage stats.',
  },
  {
    key: 'marketing_insights',
    label: 'Marketing insights',
    url: '/api/marketing-insights/report?windowDays=7',
    icon: Database,
    hint: 'Per-tenant marketing report aggregation. Heavy DB queries; crash here often means Mongo is degraded.',
  },
];

export default function SystemHealthPanel() {
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [running, setRunning] = useState(false);

  const runProbes = async () => {
    setRunning(true);
    const next: Record<string, ProbeResult> = {};
    await Promise.all(
      PROBES.map(async (p) => {
        try {
          const res = await api.get(p.url, {
            validateStatus: () => true,
            timeout: 8000,
          });
          next[p.key] = {
            ok: res.status >= 200 && res.status < 400,
            status: res.status,
            message:
              res.status >= 200 && res.status < 400
                ? 'OK'
                : ((res.data as { error?: string; message?: string })?.error ??
                  (res.data as { message?: string })?.message ??
                  `HTTP ${res.status}`),
            detail: res.data,
          };
        } catch (err) {
          // Network-level failure (ERR_CONNECTION_CLOSED lands here).
          const code = (err as { code?: string })?.code;
          const message =
            err instanceof Error ? err.message : 'Connection failed';
          next[p.key] = {
            ok: false,
            status: null,
            message: code ? `${code}: ${message}` : message,
          };
        }
      }),
    );
    setResults(next);
    setRunning(false);
  };

  useEffect(() => {
    runProbes();
  }, []);

  const failedCount = Object.values(results).filter((r) => !r.ok).length;
  const isReady = Object.keys(results).length > 0;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">System Health</h2>
          {isReady && (
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded ${
                failedCount === 0
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {failedCount === 0 ? 'All systems OK' : `${failedCount} failing`}
            </span>
          )}
        </div>
        <button
          onClick={runProbes}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          Re-run probes
        </button>
      </div>

      <p className="text-xs text-gray-600 mb-3">
        Each row hits a real endpoint and shows what it returned. Failures here
        will surface in the browser network tab as the same{' '}
        <code>ERR_CONNECTION_CLOSED</code> /<code>500</code> /<code>503</code>{' '}
        you saw — so this is the right place to debug from.
      </p>

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-md overflow-hidden">
        {PROBES.map((p) => {
          const r = results[p.key];
          const Icon = p.icon;
          const ok = r?.ok ?? null;
          return (
            <div
              key={p.key}
              className={`flex items-start gap-3 px-3 py-2.5 ${
                ok === false ? 'bg-red-50/50' : ''
              }`}
            >
              <Icon className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">
                    {p.label}
                  </span>
                  <code className="text-[10px] font-mono text-gray-500">
                    {p.url}
                  </code>
                  {r && (
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
                        ok
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {ok ? (
                        <CheckCircle2 className="h-2.5 w-2.5" />
                      ) : (
                        <XCircle className="h-2.5 w-2.5" />
                      )}
                      {r.status != null ? `HTTP ${r.status}` : 'NETWORK'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{p.hint}</p>
                {r && !ok && (
                  <p className="text-xs text-red-700 font-mono mt-1 break-all">
                    {r.message}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {failedCount > 0 && (
        <div className="mt-3 flex gap-2 items-start rounded-md bg-amber-50 ring-1 ring-amber-200 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-900">
            <p className="font-semibold mb-1">Common fixes:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>
                <code>ERR_CONNECTION_CLOSED</code> or <code>NETWORK</code> →
                server process crashed. Check server logs.
              </li>
              <li>
                HTTP 503 → MongoDB disconnected. Check <code>MONGODB_URI</code>{' '}
                + IP whitelist.
              </li>
              <li>HTTP 401 → JWT expired. Sign out + sign back in.</li>
              <li>
                HTTP 502 on a provider probe → provider SDK / credentials
                misconfigured. Visit the provider's section below to set
                env-vars correctly.
              </li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
