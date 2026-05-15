import { useEffect, useState } from 'react';
import { api } from '../config';
import { Users, Plus, RefreshCw, Sparkles } from 'lucide-react';

interface SegmentRow {
  _id: string;
  name: string;
  description?: string;
  authoredBy: 'human' | 'segmentation_agent';
  memberCount: number;
  lastComputedAt?: string;
  createdAt: string;
}

export default function Segments() {
  const [rows, setRows] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SegmentRow[]>('/api/segments');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const recompute = async (id: string) => {
    try {
      await api.post(`/api/segments/${id}/recompute`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
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
            <Users className="h-6 w-6 text-green-600" /> Contact Segments
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Group contacts by behaviour or attributes. Use them as
            targeting for campaigns and follow-ups.
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white opacity-50 cursor-not-allowed"
            title="Powered by the SegmentationAgent — Phase 2"
          >
            <Sparkles className="h-4 w-4" /> Describe a segment
          </button>
          <button
            disabled
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-green-600 text-white opacity-50 cursor-not-allowed"
            title="Manual rule builder — Phase 3"
          >
            <Plus className="h-4 w-4" /> New segment
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
          <p className="text-gray-700 font-medium">No segments defined yet</p>
          <p className="text-sm text-gray-500 mt-1">
            Two ways to author segments arrive in upcoming phases:
            <br />
            <strong>Phase 2:</strong> describe in plain language ("Japan
            jobs dormant 30d") and the SegmentationAgent translates it
            to rules.
            <br />
            <strong>Phase 3:</strong> manual rule builder.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((s) => (
            <div
              key={s._id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-gray-900">{s.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5 capitalize">
                    {s.authoredBy.replace('_', ' ')}
                  </div>
                </div>
                <span className="text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                  {s.memberCount} members
                </span>
              </div>
              {s.description && (
                <p className="text-xs text-gray-600 mt-2 line-clamp-2">
                  {s.description}
                </p>
              )}
              <div className="mt-3 flex items-center justify-end">
                <button
                  onClick={() => recompute(s._id)}
                  className="text-xs text-gray-600 hover:text-gray-900"
                >
                  Recompute
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
