import { useEffect, useState } from 'react';
import { api } from '../config';
import { Check, X, Pencil, RefreshCw, Inbox } from 'lucide-react';

interface PendingEntry {
  _id: string;
  traceId: string;
  agentName: string;
  userId: string;
  sessionId: string;
  channel: string;
  proposedMessage: string;
  createdAt: string;
  expiresAt: string;
}

export default function ApprovalQueue() {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; note: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ entries: PendingEntry[] }>('/api/agents/approvals/pending');
      setEntries(res.data.entries);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const approve = async (id: string) => {
    setBusy(id);
    try {
      await api.post(`/api/agents/approvals/${id}/approve`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    const note = prompt('Reason for rejection (optional):') ?? null;
    setBusy(id);
    try {
      await api.post(`/api/agents/approvals/${id}/reject`, { note });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(null);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    setBusy(editing.id);
    try {
      await api.post(`/api/agents/approvals/${editing.id}/edit`, {
        editedText: editing.text,
        note: editing.note || null,
      });
      setEditing(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Edit failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Inbox className="h-6 w-6 text-amber-600" /> Approval queue
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Outbound agent messages awaiting operator review. Auto-refreshes every 15 s.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      {loading && entries.length === 0 ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
          <Inbox className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-900">Inbox zero</h3>
          <p className="text-sm text-gray-500 mt-1">All caught up. No agent messages awaiting approval.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <div key={e._id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{e.agentName}</span>
                  <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-100 ring-1 ring-amber-200 px-1.5 py-0.5 rounded">{e.channel}</span>
                  <span className="text-xs text-gray-500 font-mono" title={e.userId}>{e.userId.slice(0, 32)}{e.userId.length > 32 ? '…' : ''}</span>
                </div>
                <div className="text-[11px] text-gray-500">
                  Created {new Date(e.createdAt).toLocaleTimeString()} · expires {new Date(e.expiresAt).toLocaleTimeString()}
                </div>
              </div>

              {editing?.id === e._id ? (
                <div className="mt-3">
                  <textarea
                    rows={4}
                    value={editing.text}
                    onChange={(ev) => setEditing({ ...editing, text: ev.target.value })}
                    className="w-full rounded-md border-gray-300 text-sm font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Why edited (optional)"
                    value={editing.note}
                    onChange={(ev) => setEditing({ ...editing, note: ev.target.value })}
                    className="w-full rounded-md border-gray-300 text-sm mt-2"
                  />
                  <div className="flex gap-2 mt-2">
                    <button onClick={submitEdit} disabled={busy === e._id} className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                      Save & send
                    </button>
                    <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <pre className="mt-3 p-3 bg-gray-50 rounded-md text-sm whitespace-pre-wrap text-gray-800">{e.proposedMessage}</pre>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => approve(e._id)} disabled={busy === e._id} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                      <Check className="h-4 w-4" /> Approve & send
                    </button>
                    <button onClick={() => setEditing({ id: e._id, text: e.proposedMessage, note: '' })} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                      <Pencil className="h-4 w-4" /> Edit & send
                    </button>
                    <button onClick={() => reject(e._id)} disabled={busy === e._id} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                      <X className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
