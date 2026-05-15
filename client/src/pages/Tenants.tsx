import { useEffect, useState } from 'react';
import { api } from '../config';
import { Building2, RefreshCw, Plus } from 'lucide-react';

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
            Super-admin view of every company using the platform.
            Plans, brand voice, status, and budget caps.
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
            title="Tenant onboarding wizard — Phase 4"
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
            A "default" tenant is auto-created on the first authenticated
            API request. The multi-tenant onboarding wizard and per-tenant
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
