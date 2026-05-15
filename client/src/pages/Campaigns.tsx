import { useEffect, useState } from 'react';
import { api } from '../config';
import {
  Megaphone,
  Plus,
  Play,
  Pause,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';

interface CampaignVariant {
  variantId: string;
  weight?: number;
  messageBody: string;
  generatedBy?: 'human' | 'campaign_generator_agent';
}

interface CampaignRow {
  _id: string;
  name: string;
  description?: string;
  status:
    | 'draft'
    | 'scheduled'
    | 'running'
    | 'paused'
    | 'completed'
    | 'cancelled';
  channels: string[];
  trigger: { kind: string; scheduledAt?: string };
  variants: CampaignVariant[];
  stats: {
    queued: number;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    converted: number;
  };
  createdAt: string;
}

const STATUS_BADGE: Record<CampaignRow['status'], string> = {
  draft: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
  scheduled: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  running: 'bg-green-100 text-green-700 ring-1 ring-green-200',
  paused: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  completed: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200',
  cancelled: 'bg-red-100 text-red-700 ring-1 ring-red-200',
};

interface GenerateResult {
  variants: {
    variantId: string;
    messageBody: string;
    channel: string;
    rationale: string;
  }[];
  callToAction: string;
  shouldAttachImage: boolean;
  tokensUsed: number;
  provider: string;
}

export default function Campaigns() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate dialog state
  const [generateFor, setGenerateFor] = useState<CampaignRow | null>(null);
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [variantCount, setVariantCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenerateResult | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Create campaign dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newChannels, setNewChannels] = useState<string[]>(['whatsapp']);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<CampaignRow[]>('/api/campaigns');
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

  const togglePause = async (c: CampaignRow) => {
    const path = c.status === 'running' ? 'pause' : 'resume';
    try {
      await api.post(`/api/campaigns/${c._id}/${path}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const openGenerate = (c: CampaignRow) => {
    setGenerateFor(c);
    setAudience('');
    setGoal('');
    setVariantCount(3);
    setGenResult(null);
    setGenError(null);
  };

  const runGenerate = async () => {
    if (!generateFor) return;
    setGenerating(true);
    setGenError(null);
    setGenResult(null);
    try {
      const res = await api.post<GenerateResult>(
        `/api/campaigns/${generateFor._id}/generate-variants`,
        {
          audienceDescription: audience,
          goal,
          variantCount,
        },
      );
      setGenResult(res.data);
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setGenError(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Generation failed'),
      );
    } finally {
      setGenerating(false);
    }
  };

  const createCampaign = async () => {
    if (!newName.trim()) return;
    try {
      await api.post('/api/campaigns', {
        name: newName,
        description: newDescription,
        channels: newChannels,
        status: 'draft',
        trigger: { kind: 'manual' },
        variants: [],
      });
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setNewChannels(['whatsapp']);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create');
    }
  };

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-green-600" /> Marketing Campaigns
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Multi-channel campaigns powered by the CampaignGenerator agent.
            Conversion attribution wires through to Leads &amp; Bookings.
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
            <Plus className="h-4 w-4" /> New campaign
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
          <p className="text-gray-700 font-medium">No campaigns yet</p>
          <p className="text-sm text-gray-500 mt-1">
            Click <strong>New campaign</strong> to start one. Then use{' '}
            <strong>Generate variants</strong> to have the AI draft
            language-mirrored A/B copy from a brief.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Channels</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Variants</th>
                <th className="text-right px-3 py-2">Sent</th>
                <th className="text-right px-3 py-2">Replied</th>
                <th className="text-right px-3 py-2">Converted</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c._id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {c.name}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {(c.channels || []).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.variants?.length ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right">{c.stats.sent}</td>
                  <td className="px-3 py-2 text-right">{c.stats.replied}</td>
                  <td className="px-3 py-2 text-right">{c.stats.converted}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openGenerate(c)}
                        className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Generate
                      </button>
                      {(c.status === 'running' || c.status === 'paused') && (
                        <button
                          onClick={() => togglePause(c)}
                          className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900"
                        >
                          {c.status === 'running' ? (
                            <>
                              <Pause className="h-3.5 w-3.5" /> Pause
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5" /> Resume
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">New campaign</h3>
              <button
                onClick={() => setShowCreate(false)}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Name</label>
                <input
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Spring promo"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Description
                </label>
                <textarea
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Channels
                </label>
                <div className="flex flex-wrap gap-2">
                  {['whatsapp', 'telegram', 'instagram', 'facebook', 'email'].map(
                    (ch) => (
                      <label
                        key={ch}
                        className="inline-flex items-center gap-1 text-xs text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={newChannels.includes(ch)}
                          onChange={(e) =>
                            setNewChannels(
                              e.target.checked
                                ? [...newChannels, ch]
                                : newChannels.filter((c) => c !== ch),
                            )
                          }
                        />
                        {ch}
                      </label>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-md text-sm border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={createCampaign}
                disabled={!newName.trim()}
                className="px-3 py-1.5 rounded-md text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {generateFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-600" /> Generate
                variants for "{generateFor.name}"
              </h3>
              <button
                onClick={() => setGenerateFor(null)}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Audience description
                </label>
                <textarea
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  rows={2}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder='e.g. "Sri Lankans aged 22-35 interested in overseas Japan factory jobs"'
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Campaign goal
                </label>
                <input
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder='e.g. "Get them to book a consultation call"'
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Variant count (1-5)
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  className="w-24 border border-gray-200 rounded px-2 py-1.5 text-sm"
                  value={variantCount}
                  onChange={(e) =>
                    setVariantCount(Math.max(1, Math.min(5, +e.target.value)))
                  }
                />
              </div>
            </div>
            {genError && (
              <div className="mt-3 rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-xs">
                {genError}
              </div>
            )}
            {genResult && (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-gray-500">
                  Generated by {genResult.provider} · {genResult.tokensUsed}{' '}
                  tokens
                </p>
                {genResult.variants.map((v) => (
                  <div
                    key={v.variantId}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600">
                        {v.variantId}
                      </span>
                      <span className="text-xs text-gray-500 capitalize">
                        {v.channel}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">
                      {v.messageBody}
                    </p>
                    {v.rationale && (
                      <p className="text-xs text-gray-500 mt-1 italic">
                        {v.rationale}
                      </p>
                    )}
                  </div>
                ))}
                {genResult.callToAction && (
                  <p className="text-xs text-gray-700 mt-2">
                    <strong>CTA:</strong> {genResult.callToAction}
                  </p>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setGenerateFor(null)}
                className="px-3 py-1.5 rounded-md text-sm border border-gray-200 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={runGenerate}
                disabled={
                  generating || audience.trim().length < 3 || goal.trim().length < 3
                }
                className="px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
