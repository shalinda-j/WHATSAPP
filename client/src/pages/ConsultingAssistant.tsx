import { useState, useEffect } from 'react';
import { api } from '../config';
import {
  Headphones,
  Search,
  Filter,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  Ticket,
} from 'lucide-react';

interface KioskInvite {
  _id: string;
  code: string;
  name: string;
  phone: string;
  course: string;
  status: 'issued' | 'redeemed' | 'converted' | 'expired';
  createdAt: string;
  completed?: boolean;
}

const STATUS_LABELS: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  issued: { label: 'Issued', color: 'text-blue-700', bg: 'bg-blue-100' },
  redeemed: {
    label: 'Redeemed',
    color: 'text-purple-700',
    bg: 'bg-purple-100',
  },
  converted: {
    label: 'Converted',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
  },
  expired: { label: 'Expired', color: 'text-red-700', bg: 'bg-red-100' },
};

export default function ConsultingAssistant() {
  const [invites, setInvites] = useState<KioskInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const fetchInvites = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/kiosk-admin/invites');
      const data = res.data?.invites || [];
      setInvites(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setInvites([]);
      const detail =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Failed to load invites — check your connection';
      setMessage({ type: 'error', text: detail });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvites();
  }, []);

  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [message]);

  const filteredInvites = invites.filter((inv) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !searchQuery ||
      (inv.name || '').toLowerCase().includes(q) ||
      (inv.phone || '').includes(searchQuery) ||
      (inv.code || '').toLowerCase().includes(q) ||
      (inv.course || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = [
    {
      label: 'Total Invites',
      value: invites.length,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Redeemed',
      value: invites.filter((i) => i.status === 'redeemed').length,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      label: 'Converted',
      value: invites.filter((i) => i.status === 'converted').length,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Expired',
      value: invites.filter((i) => i.status === 'expired').length,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-8">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl">
              <Headphones className="h-6 w-6 text-white" />
            </div>
            Consulting Assistant AI
          </h1>
          <p className="text-gray-500 mt-1 ml-1">
            Branch Voice Consultant kiosk invites and conversions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchInvites}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notification */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm border ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border-green-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {message.text}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`${s.bg} rounded-xl p-4 border border-white`}
          >
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, mobile, code or course..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
          >
            <option value="all">All Status</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
          </div>
        ) : filteredInvites.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <Ticket className="h-12 w-12 mb-2 opacity-30" />
            <p className="text-sm">No invites found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredInvites.map((inv) => {
                  const statusInfo =
                    STATUS_LABELS[inv.status] || STATUS_LABELS.issued;
                  return (
                    <tr
                      key={inv._id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-gray-900 tracking-widest">
                          {inv.code}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        {inv.name || 'Unknown'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {inv.phone || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {inv.course || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusInfo.bg} ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {inv.createdAt
                          ? new Date(inv.createdAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
