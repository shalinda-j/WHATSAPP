import { useState, useEffect, useCallback, Fragment } from 'react';
import { api } from '../config';
import { RefreshCw, ShieldAlert, Filter, AlertCircle } from 'lucide-react';

interface AuditEvent {
  _id: string;
  tenantId?: string;
  adminUsername?: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  statusCode: number;
  ip?: string;
  userAgent?: string;
  durationMs: number;
  errorMessage?: string;
  createdAt: string;
  requestSummary?: Record<string, unknown>;
}

const METHOD_COLORS: Record<string, string> = {
  POST: 'bg-blue-100 text-blue-700',
  PUT: 'bg-amber-100 text-amber-700',
  PATCH: 'bg-violet-100 text-violet-700',
  DELETE: 'bg-red-100 text-red-700',
};

function statusBadge(status: number): string {
  if (status >= 500) return 'bg-red-100 text-red-700';
  if (status >= 400) return 'bg-orange-100 text-orange-700';
  if (status >= 300) return 'bg-yellow-100 text-yellow-700';
  return 'bg-green-100 text-green-700';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export default function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminFilter, setAdminFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [pathFilter, setPathFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '200' };
      if (adminFilter) params.admin = adminFilter;
      if (methodFilter) params.method = methodFilter;
      if (pathFilter) params.path = pathFilter;
      const res = await api.get('/api/audit', { params });
      setEvents(res.data.events ?? []);
    } catch (err) {
      console.error('Failed to fetch audit events', err);
    } finally {
      setLoading(false);
    }
  }, [adminFilter, methodFilter, pathFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-indigo-600" />
            Audit Log
          </h1>
          <p className="text-gray-500 mt-2">
            Every mutating admin API call recorded with who / what / when.
            Sensitive fields are redacted before write.
          </p>
        </div>
        <button
          onClick={fetchEvents}
          className="p-2 text-gray-500 hover:text-indigo-600 transition"
          title="Refresh"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="flex items-center gap-2 mb-3 text-gray-600 text-sm font-semibold">
          <Filter className="w-4 h-4" />
          Filters
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Admin username"
            value={adminFilter}
            onChange={(e) => setAdminFilter(e.target.value)}
            className="p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="">All methods</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            type="text"
            placeholder="Path contains (e.g. /api/leads)"
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
            className="p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none md:col-span-2"
          />
        </div>
      </div>

      {/* Events */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-gray-300" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
          <ShieldAlert className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No audit events match the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Admin</th>
                <th className="text-left px-4 py-3">Method</th>
                <th className="text-left px-4 py-3">Path</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Latency</th>
                <th className="text-left px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((ev) => {
                const isOpen = expanded.has(ev._id);
                return (
                  <Fragment key={ev._id}>
                    <tr
                      onClick={() => toggleExpand(ev._id)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {fmtTime(ev.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {ev.adminUsername ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full font-mono ${METHOD_COLORS[ev.method] ?? 'bg-gray-100 text-gray-700'}`}
                        >
                          {ev.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-md truncate">
                        {ev.path}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${statusBadge(ev.statusCode)}`}
                        >
                          {ev.statusCode}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {fmtDuration(ev.durationMs)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                        {ev.ip ?? '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div>
                              <div className="text-gray-500 mb-1">User-Agent</div>
                              <div className="font-mono text-gray-700 break-all">
                                {ev.userAgent ?? '—'}
                              </div>
                            </div>
                            {ev.errorMessage && (
                              <div>
                                <div className="text-gray-500 mb-1 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 text-red-500" />
                                  Error
                                </div>
                                <div className="font-mono text-red-700">
                                  {ev.errorMessage}
                                </div>
                              </div>
                            )}
                            <div className="md:col-span-2">
                              <div className="text-gray-500 mb-1">
                                Request summary (sensitive fields redacted)
                              </div>
                              <pre className="bg-white p-3 rounded-md border border-gray-200 overflow-x-auto text-gray-700">
                                {JSON.stringify(ev.requestSummary ?? {}, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
