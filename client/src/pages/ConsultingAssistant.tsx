import { useCallback, useEffect, useState } from 'react';
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
  Plus,
  X,
  Copy,
  Check,
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

/**
 * How long a hand-issued code stays usable.
 *
 * A walk-in standing at the counter should get a code that dies with the visit
 * — leaving a working code lying around for a week is how a stranger ends up
 * inside somebody else's consultation. Longer options exist for codes handed
 * out ahead of a booked visit.
 */
const VALIDITY_OPTIONS = [
  { value: 1, label: 'Today only (24 hours)' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
];

interface GenerateForm {
  name: string;
  phone: string;
  course: string;
  branch: string;
  validDays: number;
  deliver: boolean;
}

const EMPTY_FORM: GenerateForm = {
  name: '',
  phone: '',
  course: '',
  branch: '',
  validDays: 1,
  deliver: true,
};

interface GeneratedCode {
  code: string;
  expiresAt?: string;
  delivered?: boolean;
  branch?: string;
  name: string;
}

export default function ConsultingAssistant() {
  const [invites, setInvites] = useState<KioskInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // ── Manual code generation ────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<GenerateForm>(EMPTY_FORM);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedCode | null>(null);
  const [copied, setCopied] = useState(false);

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

  const openForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setGenerated(null);
    setCopied(false);
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setGenerated(null);
    setCopied(false);
  }, []);

  // The backend accepts a contact, a phone, or a name — a walk-in may only have
  // given their name at the counter.
  const canGenerate =
    !generating && (form.name.trim() !== '' || form.phone.trim() !== '');

  const generateCode = useCallback(async () => {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const { data } = await api.post('/api/kiosk-admin/invite', {
        name: form.name.trim() || undefined,
        phone: form.phone.trim() || undefined,
        course: form.course.trim() || undefined,
        branch: form.branch.trim() || undefined,
        validDays: form.validDays,
        // Nothing to deliver to without a number, so don't claim we tried.
        deliver: form.deliver && form.phone.trim() !== '',
      });
      setGenerated({
        code: data?.code,
        expiresAt: data?.expiresAt,
        delivered: data?.delivered,
        branch: data?.branch,
        name: form.name.trim(),
      });
      setCopied(false);
      // Refresh in the background — the operator is reading the code, not
      // waiting on the table.
      void fetchInvites();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Could not generate a code. Please try again.';
      setMessage({ type: 'error', text: detail });
    } finally {
      setGenerating(false);
    }
    // fetchInvites is stable enough here — it only reads setState setters.
  }, [canGenerate, form]);

  const copyCode = useCallback(async () => {
    if (!generated?.code) return;
    try {
      await navigator.clipboard.writeText(generated.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions) — the code is on
      // screen in large type anyway, so this is not worth an error banner.
    }
  }, [generated]);

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
          <button
            onClick={openForm}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 active:bg-indigo-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Generate code
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

      {/* Generate-code dialog. Two states in one panel: the form, then the
          issued code — the operator has to read the digits out to the visitor,
          so the result replaces the form rather than closing over it. */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Generate kiosk code"
          onClick={closeForm}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">
                {generated ? 'Code ready' : 'Generate a kiosk code'}
              </h2>
              <button
                onClick={closeForm}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {generated ? (
              <div className="px-5 py-6 flex flex-col items-center gap-4">
                <p className="text-sm text-gray-500 text-center">
                  {generated.name
                    ? `Give this code to ${generated.name}`
                    : 'Give this code to the visitor'}
                </p>

                <div className="font-mono text-5xl font-black tracking-[0.3em] text-gray-900 pl-[0.3em]">
                  {generated.code}
                </div>

                <button
                  onClick={copyCode}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>

                <div className="w-full text-xs text-gray-500 space-y-1 border-t border-gray-100 pt-3">
                  {generated.branch && (
                    <p>
                      Branch:{' '}
                      <span className="text-gray-700">{generated.branch}</span>
                    </p>
                  )}
                  {generated.expiresAt && (
                    <p>
                      Valid until{' '}
                      <span className="text-gray-700">
                        {new Date(generated.expiresAt).toLocaleString()}
                      </span>
                    </p>
                  )}
                  <p>
                    {generated.delivered
                      ? 'Sent over WhatsApp as well.'
                      : 'Not sent over WhatsApp — read it out or write it down.'}
                  </p>
                </div>

                <div className="flex gap-2 w-full pt-1">
                  <button
                    onClick={openForm}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Generate another
                  </button>
                  <button
                    onClick={closeForm}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="px-5 py-4 flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void generateCode();
                }}
              >
                <div>
                  <label
                    htmlFor="kc-name"
                    className="block text-xs font-semibold text-gray-600 mb-1"
                  >
                    Visitor name
                  </label>
                  <input
                    id="kc-name"
                    type="text"
                    value={form.name}
                    autoFocus
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="e.g. Nimal Perera"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    The consultant greets them by name instead of asking for it.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="kc-phone"
                    className="block text-xs font-semibold text-gray-600 mb-1"
                  >
                    Mobile <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="kc-phone"
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, phone: e.target.value }))
                    }
                    placeholder="07XXXXXXXX"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    With a number, the consultant can pick up their existing
                    WhatsApp conversation.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="kc-course"
                      className="block text-xs font-semibold text-gray-600 mb-1"
                    >
                      Course <span className="text-gray-400">(optional)</span>
                    </label>
                    <input
                      id="kc-course"
                      type="text"
                      value={form.course}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, course: e.target.value }))
                      }
                      placeholder="e.g. IT Diploma"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="kc-branch"
                      className="block text-xs font-semibold text-gray-600 mb-1"
                    >
                      Branch <span className="text-gray-400">(optional)</span>
                    </label>
                    <input
                      id="kc-branch"
                      type="text"
                      value={form.branch}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, branch: e.target.value }))
                      }
                      placeholder="Default branch"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="kc-valid"
                    className="block text-xs font-semibold text-gray-600 mb-1"
                  >
                    Valid for
                  </label>
                  <select
                    id="kc-valid"
                    value={form.validDays}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        validDays: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {VALIDITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <label
                  className={`flex items-start gap-2.5 text-sm ${
                    form.phone.trim() ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.deliver && form.phone.trim() !== ''}
                    disabled={form.phone.trim() === ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, deliver: e.target.checked }))
                    }
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                  />
                  <span>
                    Send the code over WhatsApp
                    {form.phone.trim() === '' && (
                      <span className="block text-[11px] text-gray-400">
                        Needs a mobile number
                      </span>
                    )}
                  </span>
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!canGenerate}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generating ? 'Generating…' : 'Generate code'}
                  </button>
                </div>
                {!canGenerate && !generating && (
                  <p className="text-[11px] text-gray-400 -mt-2">
                    Enter a name or a mobile number to continue.
                  </p>
                )}
              </form>
            )}
          </div>
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
                          ? new Date(inv.createdAt).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              },
                            )
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
