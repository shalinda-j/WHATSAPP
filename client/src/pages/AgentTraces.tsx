import { Fragment, useEffect, useState } from 'react';
import { api } from '../config';
import { Search, RefreshCw } from 'lucide-react';

interface Trace {
  _id: string;
  traceId: string;
  agentName: string;
  promptVersion: number;
  userId: string;
  sessionId: string;
  channel: string;
  intent: string | null;
  input: string;
  output: string | null;
  tokensUsed: number;
  costUsd: number;
  latencyMs: number;
  confidence: number;
  outcome: string;
  reflectionNote: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const OUTCOMES = [
  '', 'pending', 'success', 'failed',
  'queued_for_approval', 'rejected_by_admin', 'no_handler',
];

export default function AgentTraces() {
  const [items, setItems] = useState<Trace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [userId, setUserId] = useState('');
  const [outcome, setOutcome] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '50' };
      if (agentName) params.agentName = agentName;
      if (userId) params.userId = userId;
      if (outcome) params.outcome = outcome;
      const res = await api.get<{ items: Trace[]; total: number }>('/api/agents/traces/list', { params });
      setItems(res.data.items);
      setTotal(res.data.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Search className="h-6 w-6 text-blue-600" /> Agent traces
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Every agent execution — drill into prompts, outputs, costs, side effects, and reflection notes.
        </p>
      </header>

      <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap gap-2 items-end">
        <FilterField label="Agent name">
          <input value={agentName} onChange={(e) => setAgentName(e.target.value)} className="rounded-md border-gray-300 text-sm w-48" />
        </FilterField>
        <FilterField label="User ID">
          <input value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded-md border-gray-300 text-sm w-48" />
        </FilterField>
        <FilterField label="Outcome">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="rounded-md border-gray-300 text-sm">
            {OUTCOMES.map((o) => <option key={o} value={o}>{o || '(any)'}</option>)}
          </select>
        </FilterField>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Apply
        </button>
        <span className="ml-auto text-xs text-gray-500">{total.toLocaleString()} total matching</span>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-gray-500 bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Agent · v</th>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Outcome</th>
              <th className="px-3 py-2 text-right">Latency</th>
              <th className="px-3 py-2 text-right">Tokens</th>
              <th className="px-3 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <Fragment key={it._id}>
                <tr
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded((p) => (p === it._id ? null : it._id))}
                >
                  <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{new Date(it.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-gray-700">{it.agentName} · v{it.promptVersion}</td>
                  <td className="px-3 py-1.5 text-gray-700 font-mono text-xs truncate max-w-[180px]" title={it.userId}>{it.userId}</td>
                  <td className="px-3 py-1.5 text-gray-700"><OutcomeBadge outcome={it.outcome} /></td>
                  <td className="px-3 py-1.5 text-right text-gray-700">{it.latencyMs}ms</td>
                  <td className="px-3 py-1.5 text-right text-gray-700">{it.tokensUsed}</td>
                  <td className="px-3 py-1.5 text-right text-gray-700">${it.costUsd.toFixed(4)}</td>
                </tr>
                {expanded === it._id && (
                  <tr className="border-t border-gray-100 bg-gray-50/50">
                    <td colSpan={7} className="px-3 py-3">
                      <DetailGrid trace={it} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {items.length === 0 && !loading && (
              <tr><td colSpan={7} className="text-center text-gray-500 py-8">No traces match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-600 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const palette: Record<string, string> = {
    success: 'bg-green-100 text-green-700 ring-green-200',
    failed: 'bg-red-100 text-red-700 ring-red-200',
    queued_for_approval: 'bg-amber-100 text-amber-700 ring-amber-200',
    rejected_by_admin: 'bg-rose-100 text-rose-700 ring-rose-200',
    no_handler: 'bg-gray-100 text-gray-500 ring-gray-200',
    pending: 'bg-blue-100 text-blue-700 ring-blue-200',
  };
  const c = palette[outcome] || 'bg-gray-100 text-gray-700 ring-gray-200';
  return <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full ring-1 ${c}`}>{outcome}</span>;
}

function DetailGrid({ trace }: { trace: Trace }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      <div>
        <h4 className="font-semibold text-gray-700 mb-1">Input</h4>
        <pre className="p-2 bg-white rounded ring-1 ring-gray-200 whitespace-pre-wrap">{trace.input}</pre>
      </div>
      <div>
        <h4 className="font-semibold text-gray-700 mb-1">Output</h4>
        <pre className="p-2 bg-white rounded ring-1 ring-gray-200 whitespace-pre-wrap">{trace.output ?? '(none)'}</pre>
      </div>
      <div className="md:col-span-2">
        <h4 className="font-semibold text-gray-700 mb-1">Metadata</h4>
        <div className="p-2 bg-white rounded ring-1 ring-gray-200 flex flex-wrap gap-x-4 gap-y-1">
          <span><b>Trace:</b> {trace.traceId}</span>
          <span><b>Session:</b> {trace.sessionId}</span>
          <span><b>Channel:</b> {trace.channel}</span>
          <span><b>Intent:</b> {trace.intent ?? '—'}</span>
          <span><b>Confidence:</b> {trace.confidence.toFixed(2)}</span>
        </div>
      </div>
      {trace.reflectionNote && (
        <div className="md:col-span-2">
          <h4 className="font-semibold text-gray-700 mb-1">Reflection note</h4>
          <pre className="p-2 bg-purple-50 rounded ring-1 ring-purple-200 whitespace-pre-wrap text-purple-900">{trace.reflectionNote}</pre>
        </div>
      )}
      {trace.errorMessage && (
        <div className="md:col-span-2">
          <h4 className="font-semibold text-gray-700 mb-1">Error</h4>
          <pre className="p-2 bg-red-50 rounded ring-1 ring-red-200 whitespace-pre-wrap text-red-900">{trace.errorMessage}</pre>
        </div>
      )}
    </div>
  );
}
