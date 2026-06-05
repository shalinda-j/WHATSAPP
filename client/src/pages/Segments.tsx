import { useEffect, useState } from 'react';
import { api } from '../config';
import { Users, Plus, RefreshCw, Sparkles, X, Trash2 } from 'lucide-react';

interface SegmentRule {
  field: string;
  operator: string;
  value: unknown;
}

interface SegmentRow {
  _id: string;
  name: string;
  description?: string;
  authoredBy: 'human' | 'segmentation_agent';
  memberCount: number;
  rules?: SegmentRule[];
  lastComputedAt?: string;
  createdAt: string;
}

// Fields the rule builder + AI translator are allowed to target. Kept in sync
// with the backend allowlist so the UI never offers a field the server drops.
const RULE_FIELDS = [
  'lead.status',
  'lead.interestedCountry',
  'lead.jobVacancyType',
  'lead.experienceYears',
  'tags',
  'lifecycleStage',
  'lastContactedAt',
  'createdAt',
];

const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equals' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: '≤' },
  { value: 'in', label: 'in (comma list)' },
  { value: 'nin', label: 'not in (comma list)' },
  { value: 'contains', label: 'contains' },
  { value: 'exists', label: 'exists' },
];

export default function Segments() {
  const [rows, setRows] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Describe-a-segment (AI) modal
  const [showDescribe, setShowDescribe] = useState(false);
  const [describeText, setDescribeText] = useState('');
  const [describing, setDescribing] = useState(false);

  // Manual builder modal
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderName, setBuilderName] = useState('');
  const [builderDesc, setBuilderDesc] = useState('');
  const [builderRules, setBuilderRules] = useState<SegmentRule[]>([
    { field: RULE_FIELDS[0], operator: 'eq', value: '' },
  ]);
  const [saving, setSaving] = useState(false);

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

  // ── Describe a segment (AI) ───────────────────────────────────────────────
  const runDescribe = async () => {
    if (describeText.trim().length < 3) return;
    setDescribing(true);
    try {
      const res = await api.post('/api/segments/from-description', {
        description: describeText.trim(),
      });
      const draft = res.data?.draft;
      if (!draft) throw new Error('No segment draft returned');
      // Persist the AI draft as a real segment.
      await api.post('/api/segments', {
        name: draft.name,
        description: draft.description,
        authoredBy: 'segmentation_agent',
        rules: draft.rules,
      });
      setShowDescribe(false);
      setDescribeText('');
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(ax?.response?.data?.error || 'Failed to generate segment');
    } finally {
      setDescribing(false);
    }
  };

  // ── Manual rule builder ───────────────────────────────────────────────────
  const addRule = () =>
    setBuilderRules((r) => [
      ...r,
      { field: RULE_FIELDS[0], operator: 'eq', value: '' },
    ]);
  const removeRule = (i: number) =>
    setBuilderRules((r) => r.filter((_, idx) => idx !== i));
  const updateRule = (i: number, patch: Partial<SegmentRule>) =>
    setBuilderRules((r) =>
      r.map((rule, idx) => (idx === i ? { ...rule, ...patch } : rule)),
    );

  const saveBuilder = async () => {
    if (!builderName.trim()) {
      alert('Segment name is required');
      return;
    }
    setSaving(true);
    try {
      // Normalise list operators (in/nin) from a comma string into an array.
      const rules = builderRules
        .filter((r) => r.field && r.operator)
        .map((r) => {
          if (
            (r.operator === 'in' || r.operator === 'nin') &&
            typeof r.value === 'string'
          ) {
            return {
              ...r,
              value: r.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            };
          }
          return r;
        });
      await api.post('/api/segments', {
        name: builderName.trim(),
        description: builderDesc.trim() || undefined,
        authoredBy: 'human',
        rules,
      });
      setShowBuilder(false);
      setBuilderName('');
      setBuilderDesc('');
      setBuilderRules([{ field: RULE_FIELDS[0], operator: 'eq', value: '' }]);
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(ax?.response?.data?.error || 'Failed to save segment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-green-600" /> Contact Segments
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Group contacts by behaviour or attributes. Use them as targeting for
            campaigns and follow-ups.
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
            onClick={() => setShowDescribe(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white hover:bg-violet-700"
            title="Describe a segment in plain language — the SegmentationAgent translates it to rules"
          >
            <Sparkles className="h-4 w-4" /> Describe a segment
          </button>
          <button
            onClick={() => setShowBuilder(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-green-600 text-white hover:bg-green-700"
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
            Create one with <strong>Describe a segment</strong> (plain language,
            AI-translated) or the manual <strong>New segment</strong> rule
            builder.
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

      {/* Describe-a-segment modal */}
      {showDescribe && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-600" /> Describe a
                segment
              </h3>
              <button onClick={() => setShowDescribe(false)}>
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Describe the audience in plain language. The SegmentationAgent
              turns it into rules.
            </p>
            <textarea
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              rows={3}
              value={describeText}
              onChange={(e) => setDescribeText(e.target.value)}
              placeholder="e.g. Leads who asked about Japan jobs in the last 30 days but haven't booked yet"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowDescribe(false)}
                className="px-3 py-2 text-sm rounded-md border border-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={runDescribe}
                disabled={describing || describeText.trim().length < 3}
                className="px-4 py-2 text-sm rounded-md bg-violet-600 text-white disabled:opacity-50"
              >
                {describing ? 'Generating…' : 'Generate & save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual rule builder modal */}
      {showBuilder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">New segment</h3>
              <button onClick={() => setShowBuilder(false)}>
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Name
                </label>
                <input
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={builderName}
                  onChange={(e) => setBuilderName(e.target.value)}
                  placeholder="e.g. Japan-interested, dormant"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Description (optional)
                </label>
                <input
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={builderDesc}
                  onChange={(e) => setBuilderDesc(e.target.value)}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    Rules (all must match)
                  </label>
                  <button
                    onClick={addRule}
                    className="text-xs text-green-700 hover:underline"
                  >
                    + Add rule
                  </button>
                </div>
                <div className="space-y-2">
                  {builderRules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1"
                        value={rule.field}
                        onChange={(e) =>
                          updateRule(i, { field: e.target.value })
                        }
                      >
                        {RULE_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <select
                        className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                        value={rule.operator}
                        onChange={(e) =>
                          updateRule(i, { operator: e.target.value })
                        }
                      >
                        {OPERATORS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {rule.operator !== 'exists' && (
                        <input
                          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1"
                          value={String(rule.value ?? '')}
                          onChange={(e) =>
                            updateRule(i, { value: e.target.value })
                          }
                          placeholder="value"
                        />
                      )}
                      {builderRules.length > 1 && (
                        <button
                          onClick={() => removeRule(i)}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowBuilder(false)}
                className="px-3 py-2 text-sm rounded-md border border-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={saveBuilder}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-md bg-green-600 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Create segment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
