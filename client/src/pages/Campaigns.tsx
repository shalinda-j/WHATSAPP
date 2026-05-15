import { useEffect, useState } from 'react';
import { api } from '../config';
import { Megaphone, Plus, Play, Pause, RefreshCw } from 'lucide-react';

interface CampaignRow {
  _id: string;
  name: string;
  status:
    | 'draft'
    | 'scheduled'
    | 'running'
    | 'paused'
    | 'completed'
    | 'cancelled';
  channels: string[];
  trigger: { kind: string; scheduledAt?: string };
  stats: {
    queued: number;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    converted: number;
  };
  createdAt: string;
}

const STATUS_BADGE: Record<CampaignRow['status'], string> = {
  draft: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
  scheduled: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  running: 'bg-green-100 text-green-700 ring-1 ring-green-200',
  paused: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  completed: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200',
  cancelled: 'bg-red-100 text-red-700 ring-1 ring-red-200',
};

export default function Campaigns() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<CampaignRow[]>('/api/campaigns');
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

  const togglePause = async (c: CampaignRow) => {
    const path = c.status === 'running' ? 'pause' : 'resume';
    try {
      await api.post(`/api/campaigns/${c._id}/${path}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-green-600" /> Marketing Campaigns
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Build, schedule and track multi-channel campaigns. AI-generated
            variants, segmented audiences, conversion attribution.
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
            title="Campaign builder arrives in Phase 3"
          >
            <Plus className="h-4 w-4" /> New campaign
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
          <p className="text-gray-700 font-medium">No campaigns yet</p>
          <p className="text-sm text-gray-500 mt-1">
            The campaign builder, A/B variant generator (powered by the
            CampaignGenerator agent), and rate-limited sender pipeline are
            delivered in Phase 3 of the multi-agent marketing rollout.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Channels</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Sent</th>
                <th className="text-right px-3 py-2">Replied</th>
                <th className="text-right px-3 py-2">Converted</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c._id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {c.name}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {c.channels.join(', ')}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{c.stats.sent}</td>
                  <td className="px-3 py-2 text-right">{c.stats.replied}</td>
                  <td className="px-3 py-2 text-right">{c.stats.converted}</td>
                  <td className="px-3 py-2 text-right">
                    {(c.status === 'running' || c.status === 'paused') && (
                      <button
                        onClick={() => togglePause(c)}
                        className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900"
                      >
                        {c.status === 'running' ? (
                          <>
                            <Pause className="h-3.5 w-3.5" /> Pause
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5" /> Resume
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
