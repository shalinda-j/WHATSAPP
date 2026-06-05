import { useEffect, useState } from 'react';
import { api } from '../../config';
import {
  Plus,
  Trash2,
  Edit,
  Save,
  X,
  GraduationCap,
  Sparkles,
  Filter,
  ToggleLeft,
  ToggleRight,
  Users,
} from 'lucide-react';

type Category =
  | 'sales'
  | 'marketing'
  | 'support'
  | 'personalisation'
  | 'tone'
  | 'other';

interface ExampleSnippet {
  input: string;
  expectedOutput: string;
  tags: string[];
}

interface Skill {
  _id: string;
  name: string;
  description?: string;
  category: Category;
  promptSection: string;
  exampleSnippets: ExampleSnippet[];
  assignedAgents: string[];
  isActive: boolean;
}

interface ListResponse {
  skills: Skill[];
  availableAgents: string[];
}

const CATEGORY_META: Record<
  Category,
  { label: string; bg: string; fg: string }
> = {
  sales: { label: 'Sales', bg: 'bg-blue-100', fg: 'text-blue-800' },
  marketing: {
    label: 'Marketing',
    bg: 'bg-purple-100',
    fg: 'text-purple-800',
  },
  support: { label: 'Support', bg: 'bg-green-100', fg: 'text-green-800' },
  personalisation: {
    label: 'Personalisation',
    bg: 'bg-pink-100',
    fg: 'text-pink-800',
  },
  tone: { label: 'Tone', bg: 'bg-yellow-100', fg: 'text-yellow-800' },
  other: { label: 'Other', bg: 'bg-gray-100', fg: 'text-gray-700' },
};

const STARTER_TEMPLATES: Array<{
  label: string;
  data: Partial<Skill>;
}> = [
  {
    label: 'BANT qualification',
    data: {
      name: 'BANT Qualification',
      category: 'sales',
      description:
        'Budget / Authority / Need / Timeline framework for lead qualification.',
      promptSection: `Apply the BANT framework when qualifying leads:
- BUDGET: ask price-band questions before pitching anything specific
- AUTHORITY: identify if they're the decision-maker; if not, ask who is
- NEED: surface pain points with "what's costing you most..." framing
- TIMELINE: anchor urgency ("30/60/90 days?")
Reply concisely. End with one specific next-step question, never an open one.`,
    },
  },
  {
    label: 'AIDA copy',
    data: {
      name: 'AIDA Copywriting',
      category: 'marketing',
      description: 'Attention / Interest / Desire / Action structure.',
      promptSection: `Structure every persuasive reply as AIDA:
- ATTENTION: open with a surprising stat or sharp observation
- INTEREST: tie it to their specific pain
- DESIRE: paint the after-state in concrete terms (numbers, outcomes)
- ACTION: end with one clear next step the user can take immediately
Keep total length under 4 sentences.`,
    },
  },
  {
    label: 'PAS (Problem-Agitate-Solution)',
    data: {
      name: 'PAS Copywriting',
      category: 'marketing',
      description:
        'Problem → Agitate → Solution — high-conversion direct-response structure.',
      promptSection: `Structure persuasive replies as PAS:
- PROBLEM: state their pain back to them (one sentence)
- AGITATE: amplify the cost of NOT solving it (one sentence, no fear-mongering)
- SOLUTION: introduce the product as the natural fix (one sentence + CTA)
Never use PAS for objection-handling — use BANT or Cialdini-reciprocity there.`,
    },
  },
  {
    label: 'Cialdini reciprocity',
    data: {
      name: "Cialdini's Reciprocity",
      category: 'personalisation',
      description: 'Lead with value; trigger reciprocity without being pushy.',
      promptSection: `When the user hasn't asked for anything specific:
- Offer something useful BEFORE pitching — a tip, a relevant link,
  a quick calculation, a sample. The "give" must be free, immediate,
  and tailored.
- Only AFTER giving value, you may ask for engagement (a reply, a
  click, a meeting). Never ask before giving.
- Keep tone warm and specific to the user's situation.`,
    },
  },
  {
    label: 'Brand voice — friendly Sinhala',
    data: {
      name: 'Brand voice — friendly Sinhala',
      category: 'tone',
      description:
        'Warm, conversational Sinhala/Singlish tone for B2C audiences.',
      promptSection: `Default to Sinhala. Use Singlish naturally where it
sounds conversational (e.g. "OK", "perfect", "let me check"). Keep
sentences short (under 12 words). Use "ඔයාට" not "ඔබට". Avoid
formal registers like "කරුණාකර" unless the user is clearly formal.
End with a friendly micro-acknowledgement when closing.`,
    },
  },
];

export default function SkillsTab({
  onDataChange,
}: {
  language?: string;
  onDataChange: () => void;
}) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<Category | 'all'>('all');
  const [agentFilter, setAgentFilter] = useState<string>('');

  const [editing, setEditing] = useState<Skill | null>(null);
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      if (agentFilter) params.set('agent', agentFilter);
      const res = await api.get<ListResponse>(
        `/api/agent-skills?${params.toString()}`,
      );
      setSkills(res.data.skills);
      setAvailableAgents(res.data.availableAgents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, agentFilter]);

  const openCreate = (preset?: Partial<Skill>) => {
    setEditing({
      _id: '',
      name: preset?.name ?? '',
      description: preset?.description ?? '',
      category: preset?.category ?? 'other',
      promptSection: preset?.promptSection ?? '',
      exampleSnippets: [],
      assignedAgents: [],
      isActive: true,
    });
    setShowModal(true);
  };

  const openEdit = (s: Skill) => {
    setEditing({ ...s });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
  };

  const save = async () => {
    if (!editing) return;
    const body = {
      name: editing.name.trim(),
      description: editing.description?.trim() || undefined,
      category: editing.category,
      promptSection: editing.promptSection.trim(),
      exampleSnippets: editing.exampleSnippets ?? [],
      assignedAgents: editing.assignedAgents ?? [],
      isActive: editing.isActive,
    };
    try {
      if (editing._id) {
        await api.patch(`/api/agent-skills/${editing._id}`, body);
      } else {
        await api.post('/api/agent-skills', body);
      }
      closeModal();
      await load();
      onDataChange();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Save failed'),
      );
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this skill?')) return;
    try {
      await api.delete(`/api/agent-skills/${id}`);
      setSkills((prev) => prev.filter((s) => s._id !== id));
      onDataChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const toggleActive = async (s: Skill) => {
    try {
      await api.patch(`/api/agent-skills/${s._id}`, {
        isActive: !s.isActive,
      });
      setSkills((prev) =>
        prev.map((x) =>
          x._id === s._id ? { ...x, isActive: !x.isActive } : x,
        ),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Toggle failed');
    }
  };

  const toggleAgentAssign = (agentName: string) => {
    if (!editing) return;
    const has = editing.assignedAgents.includes(agentName);
    setEditing({
      ...editing,
      assignedAgents: has
        ? editing.assignedAgents.filter((a) => a !== agentName)
        : [...editing.assignedAgents, agentName],
    });
  };

  const grouped = skills.reduce<Record<Category, Skill[]>>(
    (acc, s) => {
      const cat = s.category as Category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(s);
      return acc;
    },
    {
      sales: [],
      marketing: [],
      support: [],
      personalisation: [],
      tone: [],
      other: [],
    },
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-800">
            Skills library
          </h3>
          <span className="text-xs text-gray-500">
            {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as Category | 'all')
            }
            className="text-sm px-2 py-1.5 border border-gray-200 rounded bg-white"
          >
            <option value="all">All categories</option>
            {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
          {availableAgents.length > 0 && (
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="text-sm px-2 py-1.5 border border-gray-200 rounded bg-white"
            >
              <option value="">All agents</option>
              {availableAgents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => openCreate()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700"
          >
            <Plus className="h-4 w-4" /> New skill
          </button>
        </div>
      </div>

      {/* Starter templates */}
      <div className="mb-4 rounded-md border border-purple-100 bg-purple-50/40 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-purple-600" />
          <h4 className="text-xs font-semibold text-purple-800 uppercase tracking-wide">
            Quick-start templates
          </h4>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STARTER_TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => openCreate(t.data as Partial<Skill>)}
              className="text-xs px-2 py-1 rounded bg-white border border-purple-200 hover:border-purple-400 text-gray-700"
            >
              + {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-4">Loading…</div>
      ) : skills.length === 0 ? (
        <div className="text-center py-10 text-gray-500 bg-gray-50 rounded-md border border-dashed border-gray-200">
          <GraduationCap className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No skills yet</p>
          <p className="text-xs mt-1">
            Use a starter template above, or click <em>New skill</em>.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(Object.keys(grouped) as Category[])
            .filter((c) => grouped[c].length > 0)
            .map((c) => (
              <div key={c}>
                <div className="flex items-center gap-2 mb-2">
                  <Filter className="h-3 w-3 text-gray-400" />
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${CATEGORY_META[c].bg} ${CATEGORY_META[c].fg}`}
                  >
                    {CATEGORY_META[c].label}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {grouped[c].length} skills
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {grouped[c].map((s) => (
                    <div
                      key={s._id}
                      className={`rounded-md border p-3 ${
                        s.isActive
                          ? 'border-gray-200 bg-white'
                          : 'border-gray-200 bg-gray-50 opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-gray-900 text-sm truncate">
                            {s.name}
                          </h4>
                          {s.description && (
                            <p className="text-xs text-gray-600 mt-0.5">
                              {s.description}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => toggleActive(s)}
                          title={s.isActive ? 'Deactivate' : 'Activate'}
                          className="text-gray-500 hover:text-gray-800 flex-shrink-0"
                        >
                          {s.isActive ? (
                            <ToggleRight className="h-5 w-5 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                      <div className="mt-2 mb-2 text-[11px] text-gray-700 line-clamp-2 font-mono bg-gray-50 rounded px-2 py-1.5">
                        {s.promptSection.slice(0, 200)}
                        {s.promptSection.length > 200 ? '…' : ''}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        <Users className="h-3 w-3 text-gray-400" />
                        {s.assignedAgents.length === 0 ? (
                          <span className="text-[10px] text-amber-700">
                            unassigned
                          </span>
                        ) : (
                          s.assignedAgents.map((a) => (
                            <span
                              key={a}
                              className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded"
                            >
                              {a}
                            </span>
                          ))
                        )}
                      </div>
                      <div className="flex items-center gap-2 justify-end border-t border-gray-100 pt-2">
                        <button
                          onClick={() => openEdit(s)}
                          className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
                        >
                          <Edit className="h-3 w-3" /> Edit
                        </button>
                        <button
                          onClick={() => remove(s._id)}
                          className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Modal */}
      {showModal && editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-purple-600" />
                {editing._id ? 'Edit skill' : 'New skill'}
              </h3>
              <button
                onClick={closeModal}
                className="text-gray-500 hover:text-gray-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">
                    Name
                  </label>
                  <input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                    placeholder="BANT Qualification"
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">
                    Category
                  </label>
                  <select
                    value={editing.category}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        category: e.target.value as Category,
                      })
                    }
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white"
                  >
                    {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_META[c].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Short description (optional)
                </label>
                <input
                  value={editing.description ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                  placeholder="Budget / Authority / Need / Timeline."
                  className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Prompt section — concatenated onto the agent's system prompt
                </label>
                <textarea
                  rows={8}
                  value={editing.promptSection}
                  onChange={(e) =>
                    setEditing({ ...editing, promptSection: e.target.value })
                  }
                  placeholder="Apply the BANT framework when qualifying leads: ..."
                  className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Assign to agents
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {availableAgents.length === 0 && (
                    <span className="text-xs text-gray-500">
                      No agents registered.
                    </span>
                  )}
                  {availableAgents.map((a) => {
                    const checked = editing.assignedAgents.includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() => toggleAgentAssign(a)}
                        className={`text-xs px-2 py-1 rounded border transition ${
                          checked
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-purple-400'
                        }`}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="skill-active"
                  type="checkbox"
                  checked={editing.isActive}
                  onChange={(e) =>
                    setEditing({ ...editing, isActive: e.target.checked })
                  }
                  className="h-4 w-4 text-purple-600 rounded"
                />
                <label htmlFor="skill-active" className="text-sm text-gray-700">
                  Active (skill applies to assigned agents)
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="px-3 py-1.5 rounded-md text-sm border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={
                  !editing.name.trim() ||
                  editing.promptSection.trim().length < 10
                }
                className="px-3 py-1.5 rounded-md text-sm bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Save className="h-4 w-4" /> Save skill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
