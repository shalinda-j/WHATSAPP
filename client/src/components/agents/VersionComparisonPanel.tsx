import { useEffect, useState } from 'react';
import { api } from '../../config';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  BarChart3,
} from 'lucide-react';

interface VersionStats {
  version: number;
  executions: number;
  successes: number;
  failures: number;
  queuedForApproval: number;
  rejectedByAdmin: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  avgConfidence: number | null;
  positiveFeedback: number;
  negativeFeedback: number;
  neutralFeedback: number;
  netScore: number;
  avgCostPerExecution: number;
  rejectRate: number;
}

interface ComparisonResponse {
  success: boolean;
  days: number;
  since: string;
  current: VersionStats;
  candidate: VersionStats | null;
  candidateTrafficPercent: number;
  daily: Array<{
    _id: { version: number; date: string };
    executions: number;
    costUsd: number;
  }>;
}

const WINDOWS = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
];

function pctDelta(candidate: number, current: number): number | null {
  if (current === 0) return candidate === 0 ? 0 : null;
  return ((candidate - current) / current) * 100;
}

function DeltaPill({
  candidate,
  current,
  higherIsBetter,
  format = (n) => n.toFixed(2),
}: {
  candidate: number;
  current: number;
  higherIsBetter: boolean;
  format?: (n: number) => string;
}) {
  const delta = pctDelta(candidate, current);
  if (delta == null) {
    return <span className="text-[10px] text-gray-400">n/a</span>;
  }
  const isPositive = higherIsBetter ? delta > 0 : delta < 0;
  const isNeutral = Math.abs(delta) < 0.5;
  const tone = isNeutral
    ? 'bg-gray-100 text-gray-600'
    : isPositive
      ? 'bg-green-100 text-green-700'
      : 'bg-red-100 text-red-700';
  const Icon = isNeutral ? Minus : isPositive ? TrendingUp : TrendingDown;
  const sign = delta > 0 ? '+' : '';
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${tone}`}
      title={`Candidate: ${format(candidate)} vs current: ${format(current)}`}
    >
      <Icon className="h-2.5 w-2.5" /> {sign}
      {delta.toFixed(0)}%
    </span>
  );
}

function StatRow({
  label,
  current,
  candidate,
  higherIsBetter,
  format,
  highlight,
}: {
  label: string;
  current: number;
  candidate: number | null;
  higherIsBetter: boolean;
  format: (n: number) => string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-12 gap-2 items-center py-1.5 px-2 rounded ${
        highlight ? 'bg-purple-50/40' : 'odd:bg-gray-50'
      }`}
    >
      <span className="col-span-5 text-xs text-gray-700">{label}</span>
      <span className="col-span-3 text-right text-xs font-mono text-gray-900">
        {format(current)}
      </span>
      <span className="col-span-3 text-right text-xs font-mono text-gray-900">
        {candidate == null ? (
          <span className="text-gray-300">—</span>
        ) : (
          format(candidate)
        )}
      </span>
      <span className="col-span-1 text-right">
        {candidate != null && (
          <DeltaPill
            candidate={candidate}
            current={current}
            higherIsBetter={higherIsBetter}
            format={format}
          />
        )}
      </span>
    </div>
  );
}

export default function VersionComparisonPanel({
  agentName,
}: {
  agentName: string;
}) {
  const [data, setData] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(7);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ComparisonResponse>(
        `/api/agents/${agentName}/comparison?days=${days}`,
      );
      setData(res.data);
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to load'),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName, days]);

  const fmtInt = (n: number) => Math.round(n).toLocaleString();
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
  const fmtMs = (n: number) => `${Math.round(n)} ms`;
  const fmtScore = (n: number) => n.toFixed(3);

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 mt-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-indigo-600" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
            A/B comparison
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-gray-100 rounded p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => setDays(w.value)}
                className={`text-xs px-2.5 py-1 rounded transition ${
                  days === w.value
                    ? 'bg-white shadow-sm font-semibold text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="text-gray-500 text-sm py-4">Loading…</div>
      ) : !data ? null : (
        <>
          {/* Header row */}
          <div className="grid grid-cols-12 gap-2 mb-2 px-2">
            <span className="col-span-5 text-[10px] uppercase tracking-wide text-gray-400">
              Metric (last {data.days}d)
            </span>
            <span className="col-span-3 text-right text-[10px] uppercase tracking-wide text-green-700 font-semibold">
              v{data.current.version} (current)
            </span>
            <span className="col-span-3 text-right text-[10px] uppercase tracking-wide text-purple-700 font-semibold">
              {data.candidate
                ? `v${data.candidate.version} (cand, ${data.candidateTrafficPercent}%)`
                : 'no candidate'}
            </span>
            <span className="col-span-1 text-right text-[10px] uppercase tracking-wide text-gray-400">
              Δ
            </span>
          </div>

          <div className="space-y-0.5">
            <StatRow
              label="Executions"
              current={data.current.executions}
              candidate={data.candidate?.executions ?? null}
              higherIsBetter={true}
              format={fmtInt}
            />
            <StatRow
              label="Success outcomes"
              current={data.current.successes}
              candidate={data.candidate?.successes ?? null}
              higherIsBetter={true}
              format={fmtInt}
            />
            <StatRow
              label="Failures"
              current={data.current.failures}
              candidate={data.candidate?.failures ?? null}
              higherIsBetter={false}
              format={fmtInt}
            />
            <StatRow
              label="Admin rejected (approval mode)"
              current={data.current.rejectedByAdmin}
              candidate={data.candidate?.rejectedByAdmin ?? null}
              higherIsBetter={false}
              format={fmtInt}
            />
            <StatRow
              label="Reject rate"
              current={data.current.rejectRate}
              candidate={data.candidate?.rejectRate ?? null}
              higherIsBetter={false}
              format={fmtPct}
            />
            <StatRow
              label="Positive feedback"
              current={data.current.positiveFeedback}
              candidate={data.candidate?.positiveFeedback ?? null}
              higherIsBetter={true}
              format={fmtInt}
            />
            <StatRow
              label="Negative feedback"
              current={data.current.negativeFeedback}
              candidate={data.candidate?.negativeFeedback ?? null}
              higherIsBetter={false}
              format={fmtInt}
            />
            <StatRow
              label="Net favourability (per execution)"
              current={data.current.netScore}
              candidate={data.candidate?.netScore ?? null}
              higherIsBetter={true}
              format={fmtScore}
              highlight
            />
            <StatRow
              label="Avg latency"
              current={data.current.avgLatencyMs}
              candidate={data.candidate?.avgLatencyMs ?? null}
              higherIsBetter={false}
              format={fmtMs}
            />
            <StatRow
              label="Avg cost / execution"
              current={data.current.avgCostPerExecution}
              candidate={data.candidate?.avgCostPerExecution ?? null}
              higherIsBetter={false}
              format={fmtUsd}
            />
            <StatRow
              label="Total tokens"
              current={data.current.totalTokens}
              candidate={data.candidate?.totalTokens ?? null}
              higherIsBetter={false}
              format={fmtInt}
            />
            <StatRow
              label="Total cost"
              current={data.current.totalCostUsd}
              candidate={data.candidate?.totalCostUsd ?? null}
              higherIsBetter={false}
              format={fmtUsd}
            />
          </div>

          {data.candidate == null && (
            <p className="text-xs text-gray-500 mt-3 italic">
              No candidate set. Click <strong>Make candidate</strong> on a
              version in the table above to start an A/B test.
            </p>
          )}

          {data.candidate != null && data.candidate.executions === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded mt-3">
              Candidate has 0 executions in this window. Increase the traffic
              split or wait for more inbound messages before reading too much
              into the delta.
            </p>
          )}
        </>
      )}
    </section>
  );
}
