import { useState, useRef, type ChangeEvent } from 'react';
import {
  Upload,
  Send,
  Trash2,
  FileText,
  CheckCircle,
  AlertCircle,
  Info,
  Loader,
  Image as ImageIcon,
  X,
  ChevronDown,
  ChevronUp,
  Phone,
  Download,
} from 'lucide-react';
import { api as _api } from '../config';

// ── Types ────────────────────────────────────────────────────────────────────
interface ProgressLine {
  type: 'progress';
  current: number;
  total: number;
  number: string;
  status: 'ok' | 'error';
  error?: string;
}
interface DoneLine {
  type: 'done';
  total: number;
  success: number;
  failed: number;
  errors: { number: string; error: string }[];
}
type StreamLine = ProgressLine | DoneLine | { type: 'error'; error: string };

// ── Client-side CSV parser ────────────────────────────────────────────────────
function splitCSVRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === ';' || ch === '\t') && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function cleanPhoneNumber(raw: string): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/\D/g, '');
  if (stripped.length >= 10 && stripped.length <= 15) return stripped;
  return null;
}

function parseCSVText(text: string): { numbers: string[]; skipped: number } {
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
  const numbers: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  // Detect phone column from header
  let phoneColIndex = -1;
  const headerKeywords = [
    'phone',
    'number',
    'mobile',
    'tel',
    'contact',
    'whatsapp',
    'no',
  ];
  const firstRowCells = splitCSVRow(rows[0]?.toLowerCase() || '');
  for (let i = 0; i < firstRowCells.length; i++) {
    if (headerKeywords.some((k) => firstRowCells[i].includes(k))) {
      phoneColIndex = i;
      break;
    }
  }
  const startRow = phoneColIndex >= 0 ? 1 : 0;

  for (let rowIdx = startRow; rowIdx < rows.length; rowIdx++) {
    const cells = splitCSVRow(rows[rowIdx]);
    const candidates = phoneColIndex >= 0 ? [cells[phoneColIndex]] : cells;
    let foundInRow = false;
    for (const cell of candidates) {
      const cleaned = cleanPhoneNumber(cell);
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        numbers.push(cleaned);
        foundInRow = true;
      }
    }
    if (!foundInRow) skipped++;
  }

  return { numbers, skipped };
}

// ── Component ─────────────────────────────────────────────────────────────────
const BulkSender = () => {
  const [message, setMessage] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [manualNumbers, setManualNumbers] = useState('');
  const [delay, setDelay] = useState(5);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);

  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [progressLines, setProgressLines] = useState<ProgressLine[]>([]);
  const [done, setDone] = useState<DoneLine | null>(null);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [csvInfo, setCSVInfo] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ── Media file handling ──────────────────────────────────────────────────
  const handleMediaChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaFile(file);
    setMediaPreviewUrl(
      file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    );
  };

  const clearMedia = () => {
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaFile(null);
    setMediaPreviewUrl(null);
  };

  // ── CSV Upload (client-side parser) ──────────────────────────────────────
  const handleCSVUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = ''; // reset so same file can be re-selected

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        setStatusMsg({ type: 'error', msg: 'Could not read the file' });
        return;
      }

      try {
        const { numbers, skipped } = parseCSVText(text);
        if (numbers.length === 0) {
          setStatusMsg({
            type: 'error',
            msg: 'No valid phone numbers found. The file should contain 10–15 digit phone numbers.',
          });
          return;
        }
        setRecipients((prev) => [...new Set([...prev, ...numbers])]);
        setCSVInfo(
          `Imported ${numbers.length} numbers${
            skipped > 0 ? ` (${skipped} rows skipped)` : ''
          }`,
        );
        setStatusMsg({
          type: 'success',
          msg: `✓ Imported ${numbers.length} phone numbers from ${file.name}`,
        });
      } catch (err) {
        setStatusMsg({ type: 'error', msg: `Failed to parse file: ${err}` });
      }
    };
    reader.onerror = () =>
      setStatusMsg({ type: 'error', msg: 'Failed to read file' });
    reader.readAsText(file, 'UTF-8');
  };

  // ── Manual number add ─────────────────────────────────────────────────────
  const handleAddManualNumbers = () => {
    if (!manualNumbers.trim()) return;
    const nums = manualNumbers
      .split(/[\n,;]+/)
      .map((s) => s.trim().replace(/\D/g, ''))
      .filter((s) => s.length >= 10 && s.length <= 15);

    if (nums.length === 0) {
      setStatusMsg({
        type: 'error',
        msg: 'No valid phone numbers entered (must be 10–15 digits)',
      });
      return;
    }
    setRecipients((prev) => [...new Set([...prev, ...nums])]);
    setManualNumbers('');
    setStatusMsg({
      type: 'success',
      msg: `Added ${nums.length} number${nums.length !== 1 ? 's' : ''}`,
    });
  };

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (recipients.length === 0) {
      setStatusMsg({ type: 'error', msg: 'No recipients added' });
      return;
    }
    if (!message.trim() && !mediaFile) {
      setStatusMsg({
        type: 'error',
        msg: 'Please add a message or attach an image/file',
      });
      return;
    }

    setIsSending(true);
    setProgress({ current: 0, total: recipients.length });
    setProgressLines([]);
    setDone(null);
    setShowResults(true);
    setStatusMsg({
      type: 'info',
      msg: `Sending to ${recipients.length} recipients with ${delay}s delay…`,
    });

    const formData = new FormData();
    formData.append('recipients', JSON.stringify(recipients));
    formData.append('message', message);
    formData.append('delay', delay.toString());
    if (mediaFile) formData.append('media', mediaFile);

    // Get auth token from localStorage (same as axios api instance uses)
    const token =
      localStorage.getItem('token') || sessionStorage.getItem('token') || '';

    abortRef.current = new AbortController();

    try {
      const response = await fetch('/api/bulk/send', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        // Raw fetch bypasses the axios interceptor, so route auth failures
        // through the shared handler explicitly. Without this the operator
        // gets a generic "HTTP 401" error and stays on the page with a
        // dead token.
        if (response.status === 401 || response.status === 403) {
          const { handleAuthFailure } = await import('../config');
          handleAuthFailure();
        }
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${response.status}`);
      }

      // Read streaming NDJSON response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed: StreamLine = JSON.parse(line);
            if (parsed.type === 'progress') {
              setProgress({ current: parsed.current, total: parsed.total });
              setProgressLines((prev) => [...prev, parsed]);
            } else if (parsed.type === 'done') {
              setDone(parsed);
              setProgress(null);
              setStatusMsg({
                type: parsed.failed === 0 ? 'success' : 'info',
                msg: `Completed! ✅ ${parsed.success} sent${
                  parsed.failed > 0 ? `, ❌ ${parsed.failed} failed` : ''
                }`,
              });
            } else if (parsed.type === 'error') {
              setStatusMsg({ type: 'error', msg: parsed.error });
            }
          } catch {
            /* ignore bad JSON lines */
          }
        }
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        setStatusMsg({ type: 'info', msg: 'Send cancelled' });
      } else {
        setStatusMsg({ type: 'error', msg: `Send failed: ${error.message}` });
      }
    } finally {
      setIsSending(false);
      setProgress(null);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsSending(false);
    setProgress(null);
  };

  // ── Export recipients as CSV ──────────────────────────────────────────────
  const handleExportCSV = () => {
    const csv = 'phone\n' + recipients.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'recipients.csv';
    a.click();
  };

  const pct = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Bulk Message Sender
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Broadcast messages with images to multiple WhatsApp contacts.
        </p>
      </div>

      {/* Status Bar */}
      {statusMsg && (
        <div
          className={`mb-5 p-3.5 rounded-xl flex items-start gap-3 text-sm ${
            statusMsg.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : statusMsg.type === 'error'
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}
        >
          {statusMsg.type === 'success' && (
            <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
          )}
          {statusMsg.type === 'error' && (
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          )}
          {statusMsg.type === 'info' && (
            <Info className="h-5 w-5 shrink-0 mt-0.5" />
          )}
          <span className="flex-1">{statusMsg.msg}</span>
          <button
            onClick={() => setStatusMsg(null)}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: Message & Media ─────────────────────────────────── */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-500" /> Message Content
            </h2>

            {/* Message textarea */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Message Text{' '}
                <span className="text-gray-400 font-normal">
                  (optional if image attached)
                </span>
              </label>
              <textarea
                rows={5}
                className="w-full text-sm border border-gray-300 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                placeholder="Type your message here…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1 text-right">
                {message.length} characters
              </p>
            </div>

            {/* Media upload */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Attach Image / File{' '}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>

              {mediaFile ? (
                <div className="border-2 border-indigo-300 bg-indigo-50 rounded-xl p-3">
                  {mediaPreviewUrl ? (
                    <div className="relative">
                      <img
                        src={mediaPreviewUrl}
                        alt="Preview"
                        className="w-full max-h-48 object-cover rounded-lg"
                      />
                      <button
                        onClick={clearMedia}
                        className="absolute top-2 right-2 bg-white/80 hover:bg-white rounded-full p-1 shadow"
                      >
                        <X className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-indigo-700">
                        <FileText className="h-5 w-5" />
                        <span className="truncate max-w-xs">
                          {mediaFile.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          ({(mediaFile.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      <button
                        onClick={clearMedia}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-indigo-600 mt-2 font-medium">
                    ✓ {mediaFile.type.startsWith('image/') ? 'Image' : 'File'}{' '}
                    will be sent to all recipients
                    {message.trim() && ' with the caption above'}
                  </p>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                  <ImageIcon className="h-8 w-8 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-500">
                    Click to upload image, PDF, video
                  </span>
                  <span className="text-xs text-gray-400 mt-1">Max 50 MB</span>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf,video/*,audio/*"
                    onChange={handleMediaChange}
                  />
                </label>
              )}
            </div>

            {/* Delay setting */}
            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Delay between messages
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="60"
                  value={delay}
                  onChange={(e) => setDelay(Number(e.target.value))}
                  className="flex-1 accent-indigo-600"
                />
                <span className="text-sm font-semibold text-indigo-700 w-20 text-right">
                  {delay} sec
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Recommended 5–10s to avoid WhatsApp rate limits.
              </p>
            </div>
          </div>

          {/* WhatsApp preview */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Message Preview
            </h3>
            <div className="bg-[#E5DDD5] rounded-xl p-4 min-h-[120px]">
              <div className="bg-white rounded-xl rounded-tl-none shadow-sm max-w-[85%] overflow-hidden">
                {mediaPreviewUrl && (
                  <img
                    src={mediaPreviewUrl}
                    alt="Media preview"
                    className="w-full max-h-48 object-cover"
                  />
                )}
                {mediaFile && !mediaPreviewUrl && (
                  <div className="px-3 py-2 bg-gray-100 flex items-center gap-2 text-sm text-gray-600">
                    <FileText className="h-4 w-4" />
                    {mediaFile.name}
                  </div>
                )}
                <div className="px-3 py-2">
                  {message ? (
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {message}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">
                      {mediaFile ? 'No caption' : 'Your message appears here…'}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 text-right mt-1">
                    {new Date().toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Recipients ─────────────────────────────────────── */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Phone className="h-5 w-5 text-indigo-500" />
                Recipients
                {recipients.length > 0 && (
                  <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-0.5 rounded-full">
                    {recipients.length}
                  </span>
                )}
              </h2>
              {recipients.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={handleExportCSV}
                    className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1 px-2 py-1 border border-gray-200 rounded-lg"
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </button>
                  <button
                    onClick={() => setRecipients([])}
                    className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1 px-2 py-1 border border-red-200 rounded-lg"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear All
                  </button>
                </div>
              )}
            </div>

            {/* CSV import */}
            <div className="mb-4">
              <label className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 text-sm text-gray-600 rounded-xl cursor-pointer hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                <Upload className="h-5 w-5" />
                Import from CSV / Excel
                <span className="text-xs text-gray-400">
                  (phone numbers extracted automatically)
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".csv,.xlsx,.xls,.txt"
                  onChange={handleCSVUpload}
                />
              </label>
              {csvInfo && (
                <p className="text-xs text-green-600 mt-1.5 text-center">
                  {csvInfo}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1 text-center">
                CSV format: one phone per row, or any column named
                "phone"/"number"/"mobile"
              </p>
            </div>

            {/* Manual entry */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                className="flex-1 text-sm border border-gray-300 rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="94712345678, 94798765432…"
                value={manualNumbers}
                onChange={(e) => setManualNumbers(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddManualNumbers()}
              />
              <button
                onClick={handleAddManualNumbers}
                className="px-4 py-2 text-sm font-medium rounded-xl text-indigo-700 bg-indigo-100 hover:bg-indigo-200 transition"
              >
                Add
              </button>
            </div>

            {/* Recipient list */}
            <div className="border border-gray-200 rounded-xl flex-1 overflow-hidden flex flex-col min-h-[220px]">
              <div className="overflow-y-auto flex-1">
                {recipients.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-12 text-gray-400">
                    <Phone className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm">No recipients yet</p>
                    <p className="text-xs mt-1">
                      Import a CSV or add numbers manually
                    </p>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">
                          #
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">
                          Number
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">
                          Remove
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {recipients.map((num, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-xs text-gray-400">
                            {idx + 1}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                            {num}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() =>
                                setRecipients((r) =>
                                  r.filter((_, i) => i !== idx),
                                )
                              }
                              className="text-gray-400 hover:text-red-500"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Progress & Results Panel ─────────────────────────────────── */}
      {showResults && (
        <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-6 py-4 bg-gray-50 hover:bg-gray-100 transition"
            onClick={() => setShowResults((v) => !v)}
          >
            <span className="font-semibold text-gray-800 text-sm flex items-center gap-2">
              {isSending ? (
                <>
                  <Loader className="h-4 w-4 animate-spin text-indigo-600" />{' '}
                  Sending…
                </>
              ) : done ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" /> Send
                  Complete
                </>
              ) : (
                'Results'
              )}
              {progress && (
                <span className="text-xs font-normal text-gray-500">
                  ({progress.current}/{progress.total})
                </span>
              )}
            </span>
            {showResults ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </button>

          {showResults && (
            <div className="p-5">
              {/* Progress bar */}
              {(isSending || done) && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                    <span>
                      {done
                        ? 'Completed'
                        : `Sending ${progress?.current} of ${progress?.total}…`}
                    </span>
                    <span>{done ? '100' : pct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-300"
                      style={{ width: `${done ? 100 : pct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Done summary */}
              {done && (
                <div className="flex gap-4 mb-4">
                  <div className="flex-1 bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">
                      {done.success}
                    </p>
                    <p className="text-xs text-green-600 mt-1">Sent</p>
                  </div>
                  <div className="flex-1 bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-red-700">
                      {done.failed}
                    </p>
                    <p className="text-xs text-red-600 mt-1">Failed</p>
                  </div>
                  <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-gray-700">
                      {done.total}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Total</p>
                  </div>
                </div>
              )}

              {/* Per-message log */}
              <div className="max-h-60 overflow-y-auto space-y-1 font-mono text-xs">
                {progressLines.map((line, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 px-3 py-1.5 rounded-lg ${
                      line.status === 'ok' ? 'bg-green-50' : 'bg-red-50'
                    }`}
                  >
                    {line.status === 'ok' ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <span className="text-gray-500 shrink-0">
                      [{line.current}/{line.total}]
                    </span>
                    <span
                      className={
                        line.status === 'ok' ? 'text-green-700' : 'text-red-700'
                      }
                    >
                      {line.number}
                      {line.status === 'error' && ` — ${line.error}`}
                    </span>
                  </div>
                ))}
                {progressLines.length === 0 && isSending && (
                  <div className="text-center text-gray-400 py-4">
                    Waiting for first message…
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Bottom Action Bar ────────────────────────────────────────── */}
      <div className="mt-6 flex justify-end gap-3">
        {isSending && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-2 px-5 py-3 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition"
          >
            <X className="h-4 w-4" /> Stop Sending
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={isSending || recipients.length === 0}
          className={`flex items-center gap-2 px-6 py-3 text-base font-semibold rounded-xl shadow-sm text-white transition
                        ${
                          isSending || recipients.length === 0
                            ? 'bg-indigo-300 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'
                        }`}
        >
          {isSending ? (
            <>
              <Loader className="h-5 w-5 animate-spin" /> Sending{' '}
              {progress?.current}/{recipients.length}…
            </>
          ) : (
            <>
              <Send className="h-5 w-5" /> Send to{' '}
              {recipients.length > 0
                ? `${recipients.length} Recipients`
                : 'Recipients'}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default BulkSender;
