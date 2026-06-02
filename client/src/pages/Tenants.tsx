import { useEffect, useState } from 'react';
import { api } from '../config';
import { Building2, RefreshCw, Plus, X } from 'lucide-react';

interface TenantRow {
  _id: string;
  slug: string;
  name: string;
  plan: 'free' | 'starter' | 'growth' | 'enterprise';
  status: 'active' | 'suspended' | 'archived';
  brand: {
    industry?: string;
    primaryLanguage?: string;
    timezone?: string;
  };
  createdAt: string;
}

const STATUS_BADGE: Record<TenantRow['status'], string> = {
  active: 'bg-green-100 text-green-700 ring-1 ring-green-200',
  suspended: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  archived: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
};

const PLAN_BADGE: Record<TenantRow['plan'], string> = {
  free: 'bg-gray-100 text-gray-700',
  starter: 'bg-blue-100 text-blue-700',
  growth: 'bg-violet-100 text-violet-700',
  enterprise: 'bg-amber-100 text-amber-700',
};

export default function Tenants() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-tenant modal
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    plan: 'free' as TenantRow['plan'],
    industry: '',
    primaryLanguage: 'si',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<TenantRow[]>('/api/tenants');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const createTenant = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      alert('Name and slug are required');
      return;
    }
    setCreating(true);
    try {
      await api.post('/api/tenants', {
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase(),
        plan: form.plan,
        brand: {
          industry: form.industry.trim() || undefined,
          primaryLanguage: form.primaryLanguage,
        },
      });
      setShowCreate(false);
      setForm({
        name: '',
        slug: '',
        plan: 'free',
        industry: '',
        primaryLanguage: 'si',
      });
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(ax?.response?.data?.error || 'Failed to create tenant');
    } finally {
      setCreating(false);
    }
  };

  const setTenantStatus = async (slug: string, activate: boolean) => {
    try {
      await api.post(
        `/api/tenants/${slug}/${activate ? 'activate' : 'suspend'}`,
      );
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(ax?.response?.data?.error || 'Failed to update tenant');
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
            <Building2 className="h-6 w-6 text-green-600" /> Tenants
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Super-admin view of every company using the platform. Plans, brand
            voice, status, and budget caps.
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
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-green-600 text-white hover:bg-green-700"
          >
            <Plus className="h-4 w-4" /> New tenant
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
          <p className="text-gray-700 font-medium">No tenants yet</p>
          <p className="text-sm text-gray-500 mt-1">
            A "default" tenant is auto-created on the first authenticated API
            request. The multi-tenant onboarding wizard and per-tenant
            super-admin role gate arrive in Phase 4.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Slug</th>
                <th className="text-left px-3 py-2">Plan</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Language</th>
                <th className="text-left px-3 py-2">Industry</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t._id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {t.name}
                  </td>
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs">
                    {t.slug}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${PLAN_BADGE[t.plan]}`}
                    >
                      {t.plan}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[t.status]}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {t.brand?.primaryLanguage ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {t.brand?.industry ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.status === 'active' ? (
                      <button
                        onClick={() => setTenantStatus(t.slug, false)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        onClick={() => setTenantStatus(t.slug, true)}
                        className="text-xs text-green-600 hover:underline"
                      >
                        Activate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New tenant modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">New tenant</h3>
              <button onClick={() => setShowCreate(false)}>
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Company name
                </label>
                <input
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="Work 360 Training"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Slug (lowercase, a-z 0-9 -)
                </label>
                <input
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      slug: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, ''),
                    }))
                  }
                  placeholder="work360"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Plan
                  </label>
                  <select
                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    value={form.plan}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        plan: e.target.value as TenantRow['plan'],
                      }))
                    }
                  >
                    <option value="free">Free</option>
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Language
                  </label>
                  <select
                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    value={form.primaryLanguage}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        primaryLanguage: e.target.value,
                      }))
                    }
                  >
                    <option value="si">Sinhala</option>
                    <option value="ta">Tamil</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Industry (optional)
                </label>
                <input
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={form.industry}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, industry: e.target.value }))
                  }
                  placeholder="Training / Recruitment"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-2 text-sm rounded-md border border-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={createTenant}
                disabled={creating}
                className="px-4 py-2 text-sm rounded-md bg-green-600 text-white disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create tenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
