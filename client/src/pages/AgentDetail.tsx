import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../config';
import {
  ArrowLeft,
  Save,
  Trophy,
  Archive,
  Sparkles,
  FlaskConical,
} from 'lucide-react';
import AgentTrainingPanel from '../components/agents/AgentTrainingPanel';
import VersionComparisonPanel from '../components/agents/VersionComparisonPanel';

interface PromptMetrics {
  uses: number;
  successes: number;
  failures: number;
  queuedApprovals: number;
  approvalRejects: number;
  totalLatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
  positiveFeedback: number;
  negativeFeedback: number;
  lastUsedAt: string | null;
}

interface PromptVersion {
  _id: string;
  version: number;
  systemPrompt: string;
  changelog: string;
  createdBy: string;
  isCurrent: boolean;
  isCandidate: boolean;
  archivedAt: string | null;
  metrics: PromptMetrics;
  createdAt: string;
}

interface Execution {
  _id: string;
  traceId: string;
  promptVersion: number;
  userId: string;
  outcome: string;
  input: string;
  output: string | null;
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
  createdAt: string;
}

interface AgentConfig {
  name: string;
  description: string;
  mode: 'autonomous' | 'approval' | 'disabled';
  currentPromptVersion: number;
  candidatePromptVersion: number | null;
  candidateTrafficPercent: number;
  modelOverride: string | null;
  providerOverride: string | null;
  budgetTokensPerConversation: number;
  budgetTokensPerDay: number;
  costCapUsdPerDay: number;
  confidenceThreshold: number;
  maxStepsPerMessage: number;
  isActive: boolean;
  promotionPolicy: 'auto' | 'manual';
  autoPromoteMinSamples: number;
  candidateTrafficPercentNum?: number;
}

interface DetailResponse {
  success: boolean;
  config: AgentConfig;
  versions: PromptVersion[];
  recentExecutions: Execution[];
  todayStats: {
    tokens: number;
    costUsd: number;
    executions: number;
    conversations: number;
  };
}

export default function AgentDetail() {
  const { name = '' } = useParams<{ name: string }>();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Partial<AgentConfig>>({});
  const [newPrompt, setNewPrompt] = useState('');
  const [newChangelog, setNewChangelog] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<DetailResponse>(`/api/agents/${name}`);
      setData(res.data);
      setDraft({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const saveConfig = async () => {
    if (Object.keys(draft).length === 0) return;
    setSaving(true);
    try {
      await api.patch(`/api/agents/${name}`, draft);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const createVersion = async () => {
    if (!newPrompt.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/agents/${name}/versions`, {
        systemPrompt: newPrompt,
        changelog: newChangelog,
        makeCandidate: true,
      });
      setNewPrompt('');
      setNewChangelog('');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const promote = async (version: number) => {
    if (!confirm(`Promote v${version} to current?`)) return;
    await api.patch(`/api/agents/${name}/versions/${version}`, {
      action: 'promote',
    });
    await load();
  };

  const setCandidate = async (version: number) => {
    await api.patch(`/api/agents/${name}/versions/${version}`, {
      action: 'set_candidate',
    });
    await load();
  };

  const clearCandidate = async () => {
    if (!confirm('Clear candidate? Traffic returns to 100% on current.'))
      return;
    const last = data?.versions.find((v) => v.isCandidate);
    if (!last) return;
    await api.patch(`/api/agents/${name}/versions/${last.version}`, {
      action: 'clear_candidate',
    });
    await load();
  };

  const updateTraffic = async (percent: number) => {
    try {
      await api.patch(`/api/agents/${name}/traffic`, {
        trafficPercent: percent,
      });
      // Optimistic update so the slider doesn't snap back while reload runs.
      setData((prev) =>
        prev
          ? {
              ...prev,
              config: { ...prev.config, candidateTrafficPercent: percent },
            }
          : prev,
      );
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Update failed'),
      );
    }
  };

  const archive = async (version: number) => {
    if (!confirm(`Archive v${version}?`)) return;
    await api.patch(`/api/agents/${name}/versions/${version}`, {
      action: 'archive',
    });
    await load();
  };

  if (loading && !data)
    return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!data) return <div className="text-red-600">Agent not found.</div>;

  const cfg = { ...data.config, ...draft };
  const hasDraft = Object.keys(draft).length > 0;
  const winRate = (v: PromptVersion) => {
    const uses = Math.max(1, v.metrics.uses);
    const net = v.metrics.positiveFeedback - v.metrics.negativeFeedback;
    return net / uses;
  };

  return (
    <div>
      <header className="mb-6 flex items-center gap-4 flex-wrap">
        <Link to="/agents" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {data.config.name}
          </h1>
          <p className="text-sm text-gray-500">
            {data.config.description || '—'}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="bg-white rounded-lg border border-gray-200 p-4 lg:col-span-1">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
            Configuration
          </h2>
          <div className="space-y-3 text-sm">
            <Field label="Mode">
              <select
                value={cfg.mode}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    mode: e.target.value as AgentConfig['mode'],
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              >
                <option value="autonomous">Autonomous</option>
                <option value="approval">Approval queue</option>
                <option value="disabled">Disabled</option>
              </select>
            </Field>
            <Field label="Confidence threshold (0–1)">
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={cfg.confidenceThreshold}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    confidenceThreshold: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              />
            </Field>
            <Field label="Tokens per conversation cap">
              <input
                type="number"
                value={cfg.budgetTokensPerConversation}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    budgetTokensPerConversation: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              />
            </Field>
            <Field label="Tokens per day cap">
              <input
                type="number"
                value={cfg.budgetTokensPerDay}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    budgetTokensPerDay: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              />
            </Field>
            <Field label="Cost cap USD/day">
              <input
                type="number"
                step="0.01"
                value={cfg.costCapUsdPerDay}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    costCapUsdPerDay: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              />
            </Field>
            <Field label="Candidate traffic %">
              <input
                type="number"
                min="0"
                max="100"
                value={cfg.candidateTrafficPercent}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    candidateTrafficPercent: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              />
            </Field>
            <Field label="Promotion policy">
              <select
                value={cfg.promotionPolicy}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    promotionPolicy: e.target.value as 'auto' | 'manual',
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              >
                <option value="manual">Manual (admin promotes)</option>
                <option value="auto">Auto (winning candidate promoted)</option>
              </select>
            </Field>
            <Field label="Auto-promote min samples">
              <input
                type="number"
                value={cfg.autoPromoteMinSamples}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    autoPromoteMinSamples: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              />
            </Field>
            <Field label="Provider override">
              <input
                type="text"
                placeholder="(use default)"
                value={cfg.providerOverride ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    providerOverride: e.target.value || null,
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              />
            </Field>
            <Field label="Model override">
              <input
                type="text"
                placeholder="(use default)"
                value={cfg.modelOverride ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    modelOverride: e.target.value || null,
                  }))
                }
                className="w-full rounded-md border-gray-300 text-sm"
              />
            </Field>
            <button
              onClick={saveConfig}
              disabled={!hasDraft || saving}
              className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" /> Save changes
            </button>
          </div>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
              Prompt versions
            </h2>
            <span className="text-xs text-gray-500">
              Today: {data.todayStats.executions} executions · $
              {data.todayStats.costUsd.toFixed(2)}
            </span>
          </div>
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {data.versions.map((v) => (
              <div
                key={v._id}
                className={`rounded-md border p-3 ${
                  v.isCurrent
                    ? 'border-green-300 bg-green-50/30'
                    : v.isCandidate
                      ? 'border-purple-300 bg-purple-50/30'
                      : 'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      v{v.version}
                    </span>
                    {v.isCurrent && (
                      <span className="text-[10px] uppercase font-bold text-green-700 bg-green-100 ring-1 ring-green-200 px-1.5 py-0.5 rounded">
                        Current
                      </span>
                    )}
                    {v.isCandidate && (
                      <span className="text-[10px] uppercase font-bold text-purple-700 bg-purple-100 ring-1 ring-purple-200 px-1.5 py-0.5 rounded">
                        Candidate
                      </span>
                    )}
                    {v.archivedAt && (
                      <span className="text-[10px] uppercase font-bold text-gray-500 bg-gray-100 ring-1 ring-gray-200 px-1.5 py-0.5 rounded">
                        Archived
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {!v.isCurrent && !v.archivedAt && (
                      <button
                        onClick={() => promote(v.version)}
                        className="text-xs px-2 py-1 rounded bg-green-100 text-green-800 hover:bg-green-200 inline-flex items-center gap-1"
                      >
                        <Trophy className="h-3 w-3" /> Promote
                      </button>
                    )}
                    {!v.isCurrent && !v.isCandidate && !v.archivedAt && (
                      <button
                        onClick={() => setCandidate(v.version)}
                        className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-800 hover:bg-purple-200 inline-flex items-center gap-1"
                      >
                        <FlaskConical className="h-3 w-3" /> Make candidate
                      </button>
                    )}
                    {!v.archivedAt && !v.isCurrent && (
                      <button
                        onClick={() => archive(v.version)}
                        className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 inline-flex items-center gap-1"
                      >
                        <Archive className="h-3 w-3" /> Archive
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>Uses: {v.metrics.uses}</span>
                  <span>
                    +{v.metrics.positiveFeedback} / −
                    {v.metrics.negativeFeedback}
                  </span>
                  <span>Approve-reject: {v.metrics.approvalRejects}</span>
                  <span>Net: {winRate(v).toFixed(3)}</span>
                  <span>
                    by {v.createdBy} · {new Date(v.createdAt).toLocaleString()}
                  </span>
                </div>
                {v.changelog && (
                  <p className="text-xs text-gray-600 mt-1 italic">
                    "{v.changelog}"
                  </p>
                )}
                {/* A/B traffic split — only meaningful for the candidate.
                    Capped at 50% server-side; ≥50% means "promote instead". */}
                {v.isCandidate && (
                  <div className="mt-2 rounded-md border border-purple-200 bg-purple-50/50 px-2.5 py-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-purple-800 uppercase tracking-wide">
                        Candidate traffic
                      </span>
                      <span className="text-[11px] font-mono text-purple-900">
                        {cfg.candidateTrafficPercent}% → v{v.version} ·{' '}
                        {100 - cfg.candidateTrafficPercent}% → v
                        {cfg.currentPromptVersion}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      step="5"
                      value={cfg.candidateTrafficPercent}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          candidateTrafficPercent: Number(e.target.value),
                        }))
                      }
                      onMouseUp={(e) =>
                        updateTraffic(
                          Number((e.target as HTMLInputElement).value),
                        )
                      }
                      onTouchEnd={(e) =>
                        updateTraffic(
                          Number((e.target as HTMLInputElement).value),
                        )
                      }
                      className="w-full accent-purple-600"
                    />
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-gray-500">
                        0% (paused)
                      </span>
                      <button
                        onClick={clearCandidate}
                        className="text-[10px] text-purple-700 hover:text-purple-900 underline"
                      >
                        Clear candidate
                      </button>
                      <span className="text-[10px] text-gray-500">
                        50% (cap — promote instead)
                      </span>
                    </div>
                  </div>
                )}
                <details className="mt-2">
                  <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-900">
                    View system prompt
                  </summary>
                  <pre className="mt-1 p-2 bg-gray-900 text-gray-100 rounded text-[11px] whitespace-pre-wrap overflow-x-auto max-h-60">
                    {v.systemPrompt}
                  </pre>
                </details>
              </div>
            ))}
            {data.versions.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-6">
                No prompt versions yet — create the first one below.
              </p>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2 inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-purple-600" /> New prompt
              version (becomes candidate)
            </h3>
            <input
              type="text"
              placeholder="Changelog (what changed and why)"
              value={newChangelog}
              onChange={(e) => setNewChangelog(e.target.value)}
              className="w-full mb-2 rounded-md border-gray-300 text-sm"
            />
            <textarea
              rows={6}
              placeholder="System prompt..."
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              className="w-full rounded-md border-gray-300 text-sm font-mono"
            />
            <button
              onClick={createVersion}
              disabled={!newPrompt.trim() || saving}
              className="mt-2 px-3 py-2 rounded-md bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              Create candidate version
            </button>
          </div>
        </section>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 p-4 mt-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          Recent executions
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-gray-500 bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left">When</th>
                <th className="px-2 py-1.5 text-left">User</th>
                <th className="px-2 py-1.5 text-left">v</th>
                <th className="px-2 py-1.5 text-left">Outcome</th>
                <th className="px-2 py-1.5 text-right">Latency</th>
                <th className="px-2 py-1.5 text-right">Tokens</th>
                <th className="px-2 py-1.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.recentExecutions.map((ex) => (
                <tr key={ex._id} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">
                    {new Date(ex.createdAt).toLocaleString()}
                  </td>
                  <td
                    className="px-2 py-1.5 text-gray-700 font-mono text-xs truncate max-w-[160px]"
                    title={ex.userId}
                  >
                    {ex.userId}
                  </td>
                  <td className="px-2 py-1.5 text-gray-700">
                    v{ex.promptVersion}
                  </td>
                  <td className="px-2 py-1.5 text-gray-700">{ex.outcome}</td>
                  <td className="px-2 py-1.5 text-right text-gray-700">
                    {ex.latencyMs}ms
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700">
                    {ex.tokensUsed}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700">
                    ${ex.costUsd.toFixed(4)}
                  </td>
                </tr>
              ))}
              {data.recentExecutions.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-gray-500 py-6">
                    No executions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <VersionComparisonPanel agentName={name} />
      <AgentTrainingPanel agentName={name} />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-0.5">
        {label}
      </span>
      {children}
    </label>
  );
}
