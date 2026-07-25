import { useEffect, useState } from 'react';
import { api } from '../config';
import { KeyRound, Plus, Trash, Copy, Check, ShieldCheck } from 'lucide-react';

type Scope = 'read:all' | 'read:leads' | 'read:contacts' | 'read:bookings';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: Scope[];
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

const SCOPE_OPTIONS: Scope[] = [
  'read:all',
  'read:leads',
  'read:contacts',
  'read:bookings',
];

/**
 * Manage long-lived API keys for external systems (a custom CRM) to PULL data
 * from the read-only /api/integrations/* endpoints. The raw key is shown once
 * on creation and never again.
 */
export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('read:all');
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/api-keys');
      setKeys(res.data?.keys || []);
    } catch (e) {
      console.error('Failed to load API keys', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setFreshKey(null);
    try {
      const res = await api.post('/api/api-keys', {
        name: name.trim(),
        scopes: [scope],
      });
      setFreshKey(res.data?.key || null);
      setName('');
      fetchKeys();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Failed to create key';
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key? Any system using it will stop working.'))
      return;
    try {
      await api.delete(`/api/api-keys/${id}`);
      fetchKeys();
    } catch {
      alert('Failed to revoke key');
    }
  };

  const copyKey = () => {
    if (!freshKey) return;
    navigator.clipboard?.writeText(freshKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const base = window.location.origin;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-8">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-5 h-5 text-indigo-600" />
        <h3 className="font-semibold text-lg text-gray-800">
          Integration API Keys
        </h3>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Give your custom CRM a long-lived key to pull leads, contacts and
        bookings from the read-only integration API.
      </p>

      {/* Freshly created key — shown ONCE */}
      {freshKey && (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm mb-2">
            <ShieldCheck className="w-4 h-4" /> Copy this key now — it
            won&apos;t be shown again
          </div>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 break-all rounded bg-white border border-emerald-200 px-3 py-2 font-mono text-sm text-gray-800">
              {freshKey}
            </code>
            <button
              onClick={copyKey}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 text-white text-sm font-medium hover:bg-emerald-700"
            >
              {copied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      <form
        onSubmit={create}
        className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. My CRM sync)"
          className="p-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="p-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        >
          {SCOPE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'read:all' ? 'read:all (leads + contacts + bookings)' : s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="inline-flex items-center justify-center gap-2 rounded bg-indigo-600 px-4 py-2 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> {creating ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {/* Keys list */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-gray-400">No API keys yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Key</th>
                <th className="py-2 pr-4">Scope</th>
                <th className="py-2 pr-4">Last used</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium text-gray-800">
                    {k.name}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-500">
                    {k.keyPrefix}…
                  </td>
                  <td className="py-2 pr-4 text-gray-600">
                    {k.scopes.join(', ')}
                  </td>
                  <td className="py-2 pr-4 text-gray-500">
                    {k.lastUsedAt
                      ? new Date(k.lastUsedAt).toLocaleString()
                      : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    {k.isActive ? (
                      <span className="text-emerald-600 font-medium">
                        active
                      </span>
                    ) : (
                      <span className="text-gray-400">revoked</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {k.isActive && (
                      <button
                        onClick={() => revoke(k.id)}
                        title="Revoke"
                        className="p-1.5 text-gray-400 hover:text-red-600"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Usage docs */}
      <div className="mt-6 rounded-lg bg-gray-50 border border-gray-100 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">
          How your CRM pulls data
        </p>
        <p className="text-xs text-gray-500 mb-2">
          Send the key as the <code>X-Api-Key</code> header. Poll each endpoint
          and pass the largest <code>updatedAt</code> you saw as{' '}
          <code>updatedSince</code> next time for incremental sync.
        </p>
        <pre className="overflow-x-auto rounded bg-gray-900 text-gray-100 text-xs p-3">
          {`curl -H "X-Api-Key: wbk_..." \\
  "${base}/api/integrations/leads?limit=100&updatedSince=2026-07-01T00:00:00Z"

# also: /api/integrations/contacts  and  /api/integrations/bookings
# response: { data:[...], page, limit, count, hasMore, serverTime }`}
        </pre>
      </div>
    </div>
  );
}
