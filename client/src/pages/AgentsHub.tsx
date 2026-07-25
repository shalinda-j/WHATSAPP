import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../config';
import {
  Bot,
  RefreshCw,
  AlertTriangle,
  Power,
  Zap,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type AgentMode = 'autonomous' | 'approval' | 'disabled';

interface AgentRow {
  _id: string;
  name: string;
  description: string;
  mode: AgentMode;
  currentPromptVersion: number;
  candidatePromptVersion: number | null;
  candidateTrafficPercent: number;
  budgetTokensPerDay: number;
  costCapUsdPerDay: number;
  approvalTtlHours?: number;
  isActive: boolean;
  registered: boolean;
  todayUsage: {
    tokens: number;
    costUsd: number;
    executions: number;
    conversations: number;
  };
}

interface HubResponse {
  agents: AgentRow[];
  registeredNotConfigured: string[];
  pendingApprovals: number;
}

type SkillCategory =
  'sales' | 'marketing' | 'support' | 'personalisation' | 'tone' | 'other';

interface Skill {
  _id: string;
  name: string;
  description?: string;
  category: SkillCategory;
  promptSection: string;
  assignedAgents: string[];
  isActive: boolean;
}

const CATEGORY_BADGE: Record<SkillCategory, string> = {
  sales: 'bg-green-100 text-green-700',
  marketing: 'bg-blue-100 text-blue-700',
  support: 'bg-amber-100 text-amber-700',
  personalisation: 'bg-purple-100 text-purple-700',
  tone: 'bg-pink-100 text-pink-700',
  other: 'bg-gray-100 text-gray-600',
};

const MODE_BADGE: Record<AgentMode, string> = {
  autonomous: 'bg-green-100 text-green-700 ring-1 ring-green-200',
  approval: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  disabled: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
};

const ALL_AGENTS = [
  'lead_qualifier',
  'personalization',
  'deal_agent',
  'content_recommender',
  'campaign_generator',
  'segmentation',
  'follow_up',
];

const BLANK_SKILL: Omit<Skill, '_id'> = {
  name: '',
  description: '',
  category: 'sales',
  promptSection: '',
  assignedAgents: [],
  isActive: true,
};

export default function AgentsHub() {
  const [data, setData] = useState<HubResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [editSkill, setEditSkill] = useState<Skill | null>(null);
  const [skillForm, setSkillForm] = useState<Omit<Skill, '_id'>>(BLANK_SKILL);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);

  // TTL edit state
  const [editTtl, setEditTtl] = useState<{
    name: string;
    value: number;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ success: boolean } & HubResponse>(
        '/api/agents',
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  const loadSkills = async () => {
    setSkillsLoading(true);
    try {
      const res = await api.get<{ success: boolean; skills: Skill[] }>(
        '/api/agents/skills',
      );
      setSkills(res.data.skills ?? []);
    } catch {
      // non-fatal
    } finally {
      setSkillsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (skillsOpen) loadSkills();
  }, [skillsOpen]);

  const setMode = async (name: string, mode: AgentMode) => {
    setUpdating(name);
    try {
      await api.patch(`/api/agents/${name}`, { mode });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update mode');
    } finally {
      setUpdating(null);
    }
  };

  const saveTtl = async (name: string, hours: number) => {
    try {
      await api.patch(`/api/agents/${name}`, { approvalTtlHours: hours });
      setEditTtl(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save TTL');
    }
  };

  // ── Skill modal helpers ──────────────────────────────────────────────────
  const openCreate = () => {
    setEditSkill(null);
    setSkillForm(BLANK_SKILL);
    setSkillError(null);
    setShowSkillModal(true);
  };

  const openEdit = (s: Skill) => {
    setEditSkill(s);
    setSkillForm({
      name: s.name,
      description: s.description ?? '',
      category: s.category,
      promptSection: s.promptSection,
      assignedAgents: s.assignedAgents,
      isActive: s.isActive,
    });
    setSkillError(null);
    setShowSkillModal(true);
  };

  const saveSkill = async () => {
    if (!skillForm.name.trim() || !skillForm.promptSection.trim()) {
      setSkillError('Name and Prompt Section are required.');
      return;
    }
    setSkillSaving(true);
    setSkillError(null);
    try {
      if (editSkill) {
        await api.patch(`/api/agents/skills/${editSkill._id}`, skillForm);
      } else {
        await api.post('/api/agents/skills', skillForm);
      }
      setShowSkillModal(false);
      await loadSkills();
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSkillSaving(false);
    }
  };

  const deleteSkill = async (id: string) => {
    if (
      !confirm(
        'Delete this skill? Agents using it will lose the prompt injection immediately.',
      )
    )
      return;
    try {
      await api.delete(`/api/agents/skills/${id}`);
      await loadSkills();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const toggleSkillAgent = (agentName: string) => {
    setSkillForm((prev) => ({
      ...prev,
      assignedAgents: prev.assignedAgents.includes(agentName)
        ? prev.assignedAgents.filter((a) => a !== agentName)
        : [...prev.assignedAgents, agentName],
    }));
  };

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bot className="h-6 w-6 text-green-600" /> Agents Hub
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage multi-agent orchestration, modes, budgets, approval TTLs, and
            skills.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && data.pendingApprovals > 0 && (
            <Link
              to="/agents/approvals"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-100 text-amber-800 text-sm font-medium ring-1 ring-amber-200 hover:bg-amber-200"
            >
              <AlertTriangle className="h-4 w-4" /> {data.pendingApprovals}{' '}
              pending approval{data.pendingApprovals === 1 ? '' : 's'}
            </Link>
          )}
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{' '}
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {data?.registeredNotConfigured &&
        data.registeredNotConfigured.length > 0 && (
          <div className="mb-4 p-3 rounded-md bg-blue-50 text-blue-800 text-sm ring-1 ring-blue-200">
            New agents discovered (no config row yet):{' '}
            <strong>{data.registeredNotConfigured.join(', ')}</strong>. They
            will appear once initialised on first registry reload.
          </div>
        )}

      {loading && !data ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : !data || data.agents.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
          <Bot className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-900">
            No agents configured yet
          </h3>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Specialist agents (lead qualifier, deal closer, etc.) will appear
            here once registered in code and bootstrapped on first run.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {data.agents.map((a) => (
            <div
              key={a._id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/agents/${a.name}`}
                    className="text-base font-semibold text-gray-900 hover:text-green-700 truncate block"
                  >
                    {a.name}
                  </Link>
                  <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                    {a.description || '—'}
                  </p>
                </div>
                <span
                  className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${
                    MODE_BADGE[a.mode]
                  }`}
                >
                  {a.mode}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-gray-50 rounded-md py-2">
                  <div className="text-gray-500">Today exec</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {(a.todayUsage?.executions ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-md py-2">
                  <div className="text-gray-500">Tokens</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {(a.todayUsage?.tokens ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-md py-2">
                  <div className="text-gray-500">Cost</div>
                  <div className="text-sm font-semibold text-gray-900">
                    ${(a.todayUsage?.costUsd ?? 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-500 flex items-center justify-between">
                <span>
                  Prompt v{a.currentPromptVersion}
                  {a.candidatePromptVersion != null && (
                    <span className="ml-1 text-purple-700">
                      · candidate v{a.candidatePromptVersion} (
                      {a.candidateTrafficPercent}%)
                    </span>
                  )}
                </span>
                <span className="text-gray-400">
                  Daily cap: {a.budgetTokensPerDay.toLocaleString()}t / $
                  {a.costCapUsdPerDay}
                </span>
              </div>

              {/* Approval TTL — only shown for agents in approval mode */}
              {a.mode === 'approval' && (
                <div className="flex items-center gap-2 text-xs text-gray-500 border-t border-gray-100 pt-2">
                  <span>Approval TTL:</span>
                  {editTtl?.name === a.name ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={editTtl.value}
                        onChange={(e) =>
                          setEditTtl({ name: a.name, value: +e.target.value })
                        }
                        className="w-14 border border-gray-200 rounded px-1 py-0.5 text-xs"
                      />
                      <span className="text-gray-400">h</span>
                      <button
                        onClick={() => saveTtl(a.name, editTtl.value)}
                        className="text-green-600 hover:text-green-700"
                        title="Save TTL"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setEditTtl(null)}
                        className="text-gray-400 hover:text-gray-600"
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() =>
                        setEditTtl({
                          name: a.name,
                          value: a.approvalTtlHours ?? 4,
                        })
                      }
                      className="font-medium text-amber-700 hover:text-amber-900 underline decoration-dotted"
                      title="Click to edit TTL"
                    >
                      {a.approvalTtlHours ?? 4}h
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-1.5 mt-1">
                {(['autonomous', 'approval', 'disabled'] as AgentMode[]).map(
                  (m) => (
                    <button
                      key={m}
                      disabled={updating === a.name || a.mode === m}
                      onClick={() => setMode(a.name, m)}
                      className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        a.mode === m
                          ? 'bg-gray-900 text-white cursor-default'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50'
                      }`}
                    >
                      {m === 'autonomous' ? (
                        <Power className="h-3 w-3 inline mr-0.5" />
                      ) : null}
                      {m}
                    </button>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Skills Section ──────────────────────────────────────────────────── */}
      <div className="mt-8 bg-white rounded-lg border border-gray-200">
        <button
          onClick={() => setSkillsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 rounded-lg"
        >
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-violet-600" />
            <span className="font-semibold text-gray-900">Skills</span>
            {skills.length > 0 && (
              <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                {skills.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              Reusable prompt fragments injected into agent system prompts
            </span>
            {skillsOpen ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </div>
        </button>

        {skillsOpen && (
          <div className="border-t border-gray-100 px-4 py-4">
            <div className="flex justify-end mb-4">
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white hover:bg-violet-700"
              >
                <Plus className="h-4 w-4" /> New Skill
              </button>
            </div>

            {skillsLoading ? (
              <div className="text-center py-6 text-gray-500 text-sm">
                Loading skills…
              </div>
            ) : skills.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-gray-200 rounded-lg">
                <Zap className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">
                  No skills yet
                </p>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  Create skills (BANT framework, tone guide, objection
                  handling…) and assign them to agents. They get injected into
                  the system prompt automatically at inference time.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                {skills.map((s) => (
                  <div
                    key={s._id}
                    className={`rounded-lg border p-3 ${
                      s.isActive
                        ? 'border-gray-200 bg-white'
                        : 'border-gray-100 bg-gray-50 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-gray-900">
                            {s.name}
                          </span>
                          <span
                            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold ${CATEGORY_BADGE[s.category]}`}
                          >
                            {s.category}
                          </span>
                          {!s.isActive && (
                            <span className="text-[10px] text-gray-400">
                              inactive
                            </span>
                          )}
                        </div>
                        {s.description && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {s.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openEdit(s)}
                          className="p-1 text-gray-400 hover:text-blue-600"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteSkill(s._id)}
                          className="p-1 text-gray-400 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-gray-600 line-clamp-2 font-mono bg-gray-50 rounded px-2 py-1 mb-2">
                      {s.promptSection}
                    </p>

                    <div className="flex flex-wrap gap-1">
                      {(s.assignedAgents || []).length === 0 ? (
                        <span className="text-[10px] text-gray-400 italic">
                          not assigned to any agent
                        </span>
                      ) : (
                        (s.assignedAgents || []).map((ag) => (
                          <span
                            key={ag}
                            className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded"
                          >
                            {ag}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Skill Create/Edit Modal ──────────────────────────────────────────── */}
      {showSkillModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Zap className="h-4 w-4 text-violet-600" />
                {editSkill ? 'Edit Skill' : 'New Skill'}
              </h3>
              <button
                onClick={() => setShowSkillModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  value={skillForm.name}
                  onChange={(e) =>
                    setSkillForm((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="BANT Qualification"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Category
                </label>
                <select
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  value={skillForm.category}
                  onChange={(e) =>
                    setSkillForm((p) => ({
                      ...p,
                      category: e.target.value as SkillCategory,
                    }))
                  }
                >
                  {[
                    'sales',
                    'marketing',
                    'support',
                    'personalisation',
                    'tone',
                    'other',
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Description
                </label>
                <input
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  value={skillForm.description}
                  onChange={(e) =>
                    setSkillForm((p) => ({ ...p, description: e.target.value }))
                  }
                  placeholder="Short description shown on the skill card"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Prompt Section <span className="text-red-500">*</span>
                  <span className="text-gray-400 ml-1">
                    (injected verbatim into agent system prompt)
                  </span>
                </label>
                <textarea
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono"
                  rows={5}
                  value={skillForm.promptSection}
                  onChange={(e) =>
                    setSkillForm((p) => ({
                      ...p,
                      promptSection: e.target.value,
                    }))
                  }
                  placeholder="BANT QUALIFICATION:&#10;Always gather Budget, Authority, Need, Timeline before pitching.&#10;Ask: 'What budget range are you working with?'"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {skillForm.promptSection.length}/3000 chars
                </p>
              </div>

              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Assign to agents
                </label>
                <div className="flex flex-wrap gap-2">
                  {ALL_AGENTS.map((ag) => (
                    <label
                      key={ag}
                      className="inline-flex items-center gap-1 text-xs text-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={skillForm.assignedAgents.includes(ag)}
                        onChange={() => toggleSkillAgent(ag)}
                        className="rounded"
                      />
                      {ag}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="skillActive"
                  checked={skillForm.isActive}
                  onChange={(e) =>
                    setSkillForm((p) => ({ ...p, isActive: e.target.checked }))
                  }
                />
                <label
                  htmlFor="skillActive"
                  className="text-xs text-gray-600 cursor-pointer"
                >
                  Active (injected at inference time)
                </label>
              </div>
            </div>

            {skillError && (
              <div className="mt-3 rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-xs">
                {skillError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowSkillModal(false)}
                className="px-3 py-1.5 rounded-md text-sm border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveSkill}
                disabled={skillSaving}
                className="px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {skillSaving
                  ? 'Saving…'
                  : editSkill
                    ? 'Update Skill'
                    : 'Create Skill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
