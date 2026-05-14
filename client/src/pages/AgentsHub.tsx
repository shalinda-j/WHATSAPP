import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../config';
import { Bot, RefreshCw, AlertTriangle, Power } from 'lucide-react';

type AgentMode = 'autonomous' | 'approval' | 'disabled';

interface AgentRow {
  _id: string;
  name: string;
  description: string;
  mode: AgentMode;
  currentPromptVersion: number;
  candidatePromptVersion: number | null;
  candidateTrafficPercent: number;
  budgetTokensPerDay: number;
  costCapUsdPerDay: number;
  isActive: boolean;
  registered: boolean;
  todayUsage: {
    tokens: number;
    costUsd: number;
    executions: number;
    conversations: number;
  };
}

interface HubResponse {
  agents: AgentRow[];
  registeredNotConfigured: string[];
  pendingApprovals: number;
}

const MODE_BADGE: Record<AgentMode, string> = {
  autonomous: 'bg-green-100 text-green-700 ring-1 ring-green-200',
  approval: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  disabled: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
};

export default function AgentsHub() {
  const [data, setData] = useState<HubResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ success: boolean } & HubResponse>(
        '/api/agents',
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setMode = async (name: string, mode: AgentMode) => {
    setUpdating(name);
    try {
      await api.patch(`/api/agents/${name}`, { mode });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update mode');
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bot className="h-6 w-6 text-green-600" /> Agents Hub
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage multi-agent orchestration, modes, budgets, and
            self-improvement.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && data.pendingApprovals > 0 && (
            <Link
              to="/agents/approvals"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-100 text-amber-800 text-sm font-medium ring-1 ring-amber-200 hover:bg-amber-200"
            >
              <AlertTriangle className="h-4 w-4" /> {data.pendingApprovals}{' '}
              pending approval{data.pendingApprovals === 1 ? '' : 's'}
            </Link>
          )}
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{' '}
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {data?.registeredNotConfigured &&
        data.registeredNotConfigured.length > 0 && (
          <div className="mb-4 p-3 rounded-md bg-blue-50 text-blue-800 text-sm ring-1 ring-blue-200">
            New agents discovered (no config row yet):{' '}
            <strong>{data.registeredNotConfigured.join(', ')}</strong>. They
            will appear once initialised on first registry reload.
          </div>
        )}

      {loading && !data ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : !data || data.agents.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
          <Bot className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-900">
            No agents configured yet
          </h3>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Specialist agents (lead qualifier, deal closer, etc.) will appear
            here once registered in code and bootstrapped on first run.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {data.agents.map((a) => (
            <div
              key={a._id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/agents/${a.name}`}
                    className="text-base font-semibold text-gray-900 hover:text-green-700 truncate block"
                  >
                    {a.name}
                  </Link>
                  <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                    {a.description || '—'}
                  </p>
                </div>
                <span
                  className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${
                    MODE_BADGE[a.mode]
                  }`}
                >
                  {a.mode}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-gray-50 rounded-md py-2">
                  <div className="text-gray-500">Today exec</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {a.todayUsage.executions.toLocaleString()}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-md py-2">
                  <div className="text-gray-500">Tokens</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {a.todayUsage.tokens.toLocaleString()}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-md py-2">
                  <div className="text-gray-500">Cost</div>
                  <div className="text-sm font-semibold text-gray-900">
                    ${a.todayUsage.costUsd.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-500 flex items-center justify-between">
                <span>
                  Prompt v{a.currentPromptVersion}
                  {a.candidatePromptVersion != null && (
                    <span className="ml-1 text-purple-700">
                      · candidate v{a.candidatePromptVersion} (
                      {a.candidateTrafficPercent}%)
                    </span>
                  )}
                </span>
                <span className="text-gray-400">
                  Daily cap: {a.budgetTokensPerDay.toLocaleString()}t / $
                  {a.costCapUsdPerDay}
                </span>
              </div>

              <div className="flex gap-1.5 mt-1">
                {(['autonomous', 'approval', 'disabled'] as AgentMode[]).map(
                  (m) => (
                    <button
                      key={m}
                      disabled={updating === a.name || a.mode === m}
                      onClick={() => setMode(a.name, m)}
                      className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        a.mode === m
                          ? 'bg-gray-900 text-white cursor-default'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50'
                      }`}
                    >
                      {m === 'autonomous' ? (
                        <Power className="h-3 w-3 inline mr-0.5" />
                      ) : null}
                      {m}
                    </button>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
