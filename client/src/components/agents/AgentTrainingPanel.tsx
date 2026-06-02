import { useEffect, useState, useRef } from 'react';
import { api } from '../../config';
import {
  GraduationCap,
  Upload,
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Search,
  Tag as TagIcon,
} from 'lucide-react';

interface TrainingExample {
  _id: string;
  agentName: string;
  input: string;
  expectedOutput: string;
  tags: string[];
  source: 'manual' | 'harvested';
  hasEmbedding: boolean;
  createdAt: string;
}

interface ListResponse {
  examples: TrainingExample[];
  total: number;
  embeddingProviderReady: boolean;
}

interface RetrievedResult {
  retrieved: Array<{
    input: string;
    expectedOutput: string;
    tags: string[];
    similarity: number;
    source: 'embedding' | 'keyword';
  }>;
  formatted: string;
}

export default function AgentTrainingPanel({
  agentName,
}: {
  agentName: string;
}) {
  const [examples, setExamples] = useState<TrainingExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [embeddingReady, setEmbeddingReady] = useState(false);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  // New-example draft state
  const [newInput, setNewInput] = useState('');
  const [newOutput, setNewOutput] = useState('');
  const [newTags, setNewTags] = useState('');
  const [creating, setCreating] = useState(false);

  // Test-retrieve playground
  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<RetrievedResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Bulk upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (tagFilter) params.set('tag', tagFilter);
      const res = await api.get<ListResponse>(
        `/api/agent-training/${agentName}/examples?${params.toString()}`,
      );
      setExamples(res.data.examples);
      setEmbeddingReady(res.data.embeddingProviderReady);
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to load'),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName]);

  const createExample = async () => {
    if (!newInput.trim() || !newOutput.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.post(`/api/agent-training/${agentName}/examples`, {
        input: newInput.trim(),
        expectedOutput: newOutput.trim(),
        tags: newTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setNewInput('');
      setNewOutput('');
      setNewTags('');
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Create failed'),
      );
    } finally {
      setCreating(false);
    }
  };

  const removeExample = async (id: string) => {
    if (!window.confirm('Delete this training example?')) return;
    try {
      await api.delete(`/api/agent-training/${agentName}/examples/${id}`);
      setExamples((prev) => prev.filter((e) => e._id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const reindex = async () => {
    if (!window.confirm('Re-embed every active example for this agent?'))
      return;
    try {
      const res = await api.post<{ queued: number }>(
        `/api/agent-training/${agentName}/examples/reindex`,
      );
      alert(`${res.data.queued} examples queued for re-embedding.`);
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Re-index failed'),
      );
    }
  };

  const uploadBulk = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{
        created: number;
        attempted: number;
        errors: Array<{ line: number; reason: string }>;
      }>(`/api/agent-training/${agentName}/examples/bulk`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      alert(
        `Created ${res.data.created}/${res.data.attempted} examples.` +
          (res.data.errors.length
            ? `\nFirst error: line ${res.data.errors[0].line} — ${res.data.errors[0].reason}`
            : ''),
      );
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Upload failed'),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const runTestRetrieve = async () => {
    if (!testQuery.trim() || testing) return;
    setTesting(true);
    try {
      const res = await api.post<RetrievedResult>(
        `/api/agent-training/${agentName}/examples/test-retrieve`,
        { query: testQuery, topK: 3 },
      );
      setTestResult(res.data);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Test retrieve failed');
    } finally {
      setTesting(false);
    }
  };

  const allTags = Array.from(new Set(examples.flatMap((e) => e.tags))).sort();

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 mt-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-purple-600" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
            Training data
          </h2>
          <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full font-semibold">
            {examples.length}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
              embeddingReady
                ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
            }`}
          >
            {embeddingReady ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {embeddingReady
              ? 'Embeddings: OpenAI text-embedding-3-small'
              : 'Embeddings off (set OPENAI_API_KEY) — keyword retrieval only'}
          </div>
          <button
            onClick={reindex}
            disabled={!embeddingReady}
            className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50"
            title={
              embeddingReady
                ? 'Re-embed every example (use after switching model)'
                : 'Configure OPENAI_API_KEY first'
            }
          >
            <RefreshCw className="h-3.5 w-3.5" /> Re-index
          </button>
          <label
            className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 cursor-pointer ${
              uploading
                ? 'bg-gray-100 text-gray-400'
                : 'bg-purple-600 text-white hover:bg-purple-700'
            }`}
            title="Upload JSONL — each line: {input, expectedOutput, tags?}"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? 'Uploading…' : 'Upload JSONL'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl,.txt,.json,application/x-ndjson,application/jsonl"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadBulk(f);
              }}
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}

      {/* Create + test split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="rounded-md border border-gray-200 p-3">
          <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add example
          </h3>
          <textarea
            rows={2}
            placeholder="User message / situation the agent will face"
            value={newInput}
            onChange={(e) => setNewInput(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded mb-2 focus:ring-2 focus:ring-purple-500 focus:outline-none"
          />
          <textarea
            rows={3}
            placeholder="Ideal agent reply — used as retrieval context + ground truth"
            value={newOutput}
            onChange={(e) => setNewOutput(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded mb-2 focus:ring-2 focus:ring-purple-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="tags, comma, separated (optional)"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded mb-2 focus:ring-2 focus:ring-purple-500 focus:outline-none"
          />
          <button
            onClick={createExample}
            disabled={!newInput.trim() || !newOutput.trim() || creating}
            className="w-full py-1.5 rounded-md bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
          >
            {creating ? 'Saving…' : 'Add example'}
          </button>
        </div>

        <div className="rounded-md border border-gray-200 p-3">
          <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-purple-600" /> Test retrieval
          </h3>
          <textarea
            rows={2}
            placeholder="Pretend this is a real user message — see which examples the agent would retrieve"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded mb-2 focus:ring-2 focus:ring-purple-500 focus:outline-none"
          />
          <button
            onClick={runTestRetrieve}
            disabled={!testQuery.trim() || testing}
            className="w-full py-1.5 rounded-md bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 disabled:opacity-50"
          >
            {testing ? 'Retrieving…' : 'Run retrieval'}
          </button>
          {testResult && (
            <div className="mt-2 text-xs space-y-1.5 max-h-40 overflow-auto">
              {testResult.retrieved.length === 0 ? (
                <p className="text-gray-500 italic">
                  No examples matched. Add more training data.
                </p>
              ) : (
                testResult.retrieved.map((r, i) => (
                  <div key={i} className="bg-gray-50 rounded p-1.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-mono text-[10px] text-gray-600">
                        sim {r.similarity.toFixed(3)} · {r.source}
                      </span>
                      {r.tags.length > 0 && (
                        <span className="text-[10px] text-gray-500">
                          [{r.tags.join(', ')}]
                        </span>
                      )}
                    </div>
                    <p className="text-gray-700 truncate" title={r.input}>
                      <strong>U:</strong> {r.input}
                    </p>
                    <p
                      className="text-gray-700 truncate"
                      title={r.expectedOutput}
                    >
                      <strong>A:</strong> {r.expectedOutput}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search input or expected output…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') load();
            }}
            className="w-full pl-8 pr-3 py-1.5 bg-gray-50 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        {allTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
            }}
            className="text-sm px-2 py-1.5 border border-gray-200 rounded bg-white"
          >
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={load}
          className="text-sm px-3 py-1.5 border border-gray-200 rounded bg-white hover:bg-gray-50"
        >
          Apply
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-gray-500 text-sm py-4">Loading…</div>
      ) : examples.length === 0 ? (
        <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-md border border-dashed border-gray-200">
          <GraduationCap className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No training examples yet.</p>
          <p className="text-xs mt-1">
            Add one above or upload a JSONL file with{' '}
            <code>{'{input, expectedOutput, tags}'}</code> per line.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-auto">
          {examples.map((ex) => (
            <div
              key={ex._id}
              className="rounded-md border border-gray-200 p-2.5 bg-white"
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p
                    className="text-xs text-gray-800 truncate"
                    title={ex.input}
                  >
                    <strong className="text-blue-700">User:</strong> {ex.input}
                  </p>
                  <p
                    className="text-xs text-gray-800 truncate"
                    title={ex.expectedOutput}
                  >
                    <strong className="text-green-700">Reply:</strong>{' '}
                    {ex.expectedOutput}
                  </p>
                  {ex.tags.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                      <TagIcon className="h-2.5 w-2.5 text-gray-400" />
                      {ex.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      ex.hasEmbedding
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                    title={ex.hasEmbedding ? 'Indexed' : 'Not yet embedded'}
                  >
                    {ex.hasEmbedding ? 'indexed' : 'no embed'}
                  </span>
                  <button
                    onClick={() => removeExample(ex._id)}
                    className="text-red-500 hover:text-red-700"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
