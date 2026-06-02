import { useEffect, useState } from 'react';
import { api } from '../config';
import { LineChart, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';

interface ChannelPerf {
  channel: string;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  converted: number;
  costUsd: number;
  conversionRate: number;
  costPerConversion: number;
}

interface InsightsReport {
  tenantId: string;
  windowDays: number;
  generatedAt: string;
  perChannel: ChannelPerf[];
  topCampaigns: Array<{
    campaignId: string;
    name: string;
    converted: number;
    conversionRate: number;
  }>;
  narrative?: string;
  recommendations: Array<{
    title: string;
    detail: string;
    severity: 'info' | 'opportunity' | 'warning';
  }>;
}

const SEVERITY_BADGE = {
  info: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  opportunity: 'bg-green-100 text-green-700 ring-1 ring-green-200',
  warning: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
};

export default function MarketingInsights() {
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(30);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<InsightsReport>(
        `/api/marketing-insights/report?windowDays=${windowDays}`,
      );
      setReport(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // load is stable enough — refetch only on windowDays change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays]);

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LineChart className="h-6 w-6 text-green-600" /> Marketing Insights
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Per-channel funnel, top campaigns, and AI-generated recommendations
            from the MarketingInsightsAgent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
            className="px-2 py-1.5 rounded-md text-sm border border-gray-200 bg-white"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-gray-200 bg-white hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {loading || !report ? (
        <div className="text-gray-500">Loading...</div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4" /> Per-channel funnel
            </h2>
            {report.perChannel.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
                No campaign data in the selected window. Once Phase 3 lands and
                campaigns start sending, this populates automatically.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-3 py-2">Channel</th>
                      <th className="text-right px-3 py-2">Sent</th>
                      <th className="text-right px-3 py-2">Delivered</th>
                      <th className="text-right px-3 py-2">Read</th>
                      <th className="text-right px-3 py-2">Replied</th>
                      <th className="text-right px-3 py-2">Converted</th>
                      <th className="text-right px-3 py-2">Conv rate</th>
                      <th className="text-right px-3 py-2">Cost / conv</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.perChannel.map((c) => (
                      <tr key={c.channel} className="border-t border-gray-100">
                        <td className="px-3 py-2 capitalize">{c.channel}</td>
                        <td className="px-3 py-2 text-right">{c.sent}</td>
                        <td className="px-3 py-2 text-right">{c.delivered}</td>
                        <td className="px-3 py-2 text-right">{c.read}</td>
                        <td className="px-3 py-2 text-right">{c.replied}</td>
                        <td className="px-3 py-2 text-right">{c.converted}</td>
                        <td className="px-3 py-2 text-right">
                          {(c.conversionRate * 100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right">
                          ${c.costPerConversion.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {report.topCampaigns.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">
                Top campaigns
              </h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Campaign</th>
                      <th className="px-3 py-2 text-right">Converted</th>
                      <th className="px-3 py-2 text-right">Conversion rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.topCampaigns.map((c) => (
                      <tr key={c.campaignId}>
                        <td className="px-3 py-2 text-gray-900">{c.name}</td>
                        <td className="px-3 py-2 text-right">{c.converted}</td>
                        <td className="px-3 py-2 text-right">
                          {(c.conversionRate * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" /> AI recommendations
            </h2>
            {report.recommendations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
                The MarketingInsightsAgent (Phase 6) writes recommendations here
                once it has enough campaign data to analyse.
              </div>
            ) : (
              <ul className="space-y-2">
                {report.recommendations.map((r, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-medium text-gray-900 text-sm">
                        {r.title}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${SEVERITY_BADGE[r.severity]}`}
                      >
                        {r.severity}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">{r.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
