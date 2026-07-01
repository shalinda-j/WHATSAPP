import { useState, useEffect } from 'react';
import {
  RefreshCw,
  Trash2,
  Database,
  Server,
  Smartphone,
  HardDrive,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../config';
import { useAuth } from '../context/AuthContext';

interface CacheStats {
  config: {
    keys: number;
    memoryUsage: number;
  };
  ai: {
    activeConversations: number;
    activeUsers: number;
    servicesLoaded: number;
    totalRequests: number;
  };
  system: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
}

export default function SystemMaintenance() {
  const { logout } = useAuth();
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [timestamp, setTimestamp] = useState(() => Date.now());
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Reset Modal State
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStep, setResetStep] = useState(0); // 0: Warning, 1: Type Confirm, 2: Final Yes/No
  const [resetConfirmationInput, setResetConfirmationInput] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Data Sets wipe modal state (surgical wipe — leaves runtime config
  // intact). Separate from factory reset on purpose: this is what
  // operators ACTUALLY want when they say "delete the Data Sets tabs".
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipePassword, setWipePassword] = useState('');
  const [wiping, setWiping] = useState(false);
  const [wipeResult, setWipeResult] = useState<{
    totalDeleted: number;
    deleted: Record<string, number | string>;
  } | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/system/stats');
      setStats(response.data);
      setMessage(null);
    } catch (error) {
      console.error('Error fetching stats:', error);
      setMessage({ type: 'error', text: 'Failed to fetch system statistics.' });
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (
      !confirm(
        'Are you sure you want to clear all server caches? This will reset all active conversations.',
      )
    )
      return;

    setClearing(true);
    try {
      const response = await api.post('/api/system/cache/clear', {});
      setMessage({ type: 'success', text: response.data.message });
      fetchStats();
    } catch (error) {
      console.error('Error clearing cache:', error);
      setMessage({ type: 'error', text: 'Failed to clear cache.' });
    } finally {
      setClearing(false);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const response = await api.get('/api/system/export', {
        responseType: 'blob', // Important for file download
      });

      // Create a download link and trigger it
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const filename = `data_export_${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();

      setMessage({ type: 'success', text: 'Data export started.' });
    } catch (error) {
      console.error('Error exporting data:', error);
      setMessage({ type: 'error', text: 'Failed to export data.' });
    } finally {
      setExporting(false);
    }
  };

  const handleFactoryReset = async () => {
    setIsResetting(true);
    try {
      await api.post('/api/system/reset', { confirmation: 'reset-my-system' });
      alert('System has been reset. You will be logged out.');
      logout();
      window.location.href = '/login';
    } catch (error: unknown) {
      console.error('Factory reset failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Factory reset failed.';
      setMessage({ type: 'error', text: errorMessage });
      setIsResetting(false);
      setShowResetModal(false);
      setResetStep(0);
    }
  };

  // Wipe ONLY the Data Sets tabs (Knowledge / Commands / Links / Mega
  // Text / AI Personality / Acknowledgements / Skills / Forms). Bot
  // runtime config and CRM data stay intact. Requires the admin's
  // password as a second factor — same protection level as factory
  // reset, but at a smaller blast radius.
  const handleWipeDatasets = async () => {
    setWiping(true);
    try {
      const res = await api.post<{
        success: boolean;
        totalDeleted: number;
        deleted: Record<string, number | string>;
        errors?: string[];
      }>('/api/system/wipe-datasets-content', { password: wipePassword });
      setWipeResult({
        totalDeleted: res.data.totalDeleted,
        deleted: res.data.deleted,
      });
      setWipePassword('');
      if (res.data.errors && res.data.errors.length > 0) {
        setMessage({
          type: 'error',
          text: `Wipe partially failed: ${res.data.errors.join('; ')}`,
        });
      } else {
        setMessage({
          type: 'success',
          text: `Wiped ${res.data.totalDeleted} row(s) across the Data Sets tabs.`,
        });
      }
    } catch (error: unknown) {
      console.error('Wipe failed:', error);
      const apiErr = error as { response?: { data?: { error?: string } } };
      const errorMessage =
        apiErr?.response?.data?.error ??
        (error instanceof Error ? error.message : 'Wipe failed.');
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setWiping(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(() => setTimestamp(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center">
          <Server className="mr-2" /> System Maintenance
        </h1>
        <div className="text-sm text-gray-500">
          {new Date(timestamp).toLocaleTimeString()}
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded ${
            message.type === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* CACHE STATS SECTION */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Config Cache Card */}
          <div className="bg-white p-6 rounded-lg shadow-md border-t-4 border-yellow-500">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-700">
                Config Cache
              </h2>
              <Database className="h-6 w-6 text-yellow-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Cached Items:</span>
                <span className="font-bold">{stats.config.keys}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Memory Impact:</span>
                <span className="font-mono">
                  {formatBytes(stats.config.memoryUsage)}
                </span>
              </div>
            </div>
          </div>

          {/* AI Conversations Card */}
          <div className="bg-white p-6 rounded-lg shadow-md border-t-4 border-purple-500">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-700">
                AI Conversations
              </h2>
              <Smartphone className="h-6 w-6 text-purple-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Active Conversations:</span>
                <span className="font-bold">
                  {stats.ai.activeConversations}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Active Users:</span>
                <span className="font-bold">{stats.ai.activeUsers}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Requests:</span>
                <span className="font-bold">{stats.ai.totalRequests}</span>
              </div>
            </div>
          </div>

          {/* System Memory Card */}
          <div className="bg-white p-6 rounded-lg shadow-md border-t-4 border-blue-500">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-700">
                System Memory
              </h2>
              <HardDrive className="h-6 w-6 text-blue-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Heap Used:</span>
                <span className="font-mono">
                  {formatBytes(stats.system.heapUsed)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">RSS:</span>
                <span className="font-mono">
                  {formatBytes(stats.system.rss)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACTIONS SECTION */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
          <AlertTriangle className="mr-2 text-orange-500" /> Maintenance Actions
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Clear Cache */}
          <div className="border rounded-lg p-4 bg-gray-50 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-gray-700 mb-2">
                Clear RAM Cache
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Clears conversation history and cached configurations. Does not
                delete persistent data.
              </p>
            </div>
            <div className="space-x-2">
              <button
                onClick={handleClearCache}
                disabled={loading || clearing}
                className="w-full px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 flex items-center justify-center transition-colors"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${clearing ? 'animate-spin' : ''}`}
                />
                Clear Cache
              </button>
            </div>
          </div>

          {/* Export Data */}
          <div className="border rounded-lg p-4 bg-gray-50 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-gray-700 mb-2">Export Data</h3>
              <p className="text-sm text-gray-600 mb-4">
                Download a full JSON dump of chats, sessions, and
                configurations.
              </p>
            </div>
            <button
              onClick={handleExportData}
              disabled={exporting}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center transition-colors"
            >
              <Download className="mr-2 h-4 w-4" />
              {exporting ? 'Exporting...' : 'Export Data'}
            </button>
          </div>

          {/* Wipe Data Sets tabs (surgical — keeps runtime config) */}
          <div className="border border-orange-200 rounded-lg p-4 bg-orange-50 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-orange-700 mb-2">
                Wipe Data Sets
              </h3>
              <p className="text-sm text-orange-600 mb-4">
                Deletes everything in Knowledge / Commands / Links / Mega Text /
                AI Personality / Skills / Forms tabs. Keeps runtime config so
                the bot still works. Irreversible.
              </p>
            </div>
            <button
              onClick={() => {
                setShowWipeModal(true);
                setWipePassword('');
                setWipeResult(null);
              }}
              className="w-full px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 flex items-center justify-center transition-colors font-bold"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Wipe Data Sets
            </button>
          </div>

          {/* Factory Reset */}
          <div className="border border-red-200 rounded-lg p-4 bg-red-50 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-red-700 mb-2">Factory Reset</h3>
              <p className="text-sm text-red-600 mb-4">
                ⚠️ DANGER: Wipes all data. This action is irreversible.
              </p>
            </div>
            <button
              onClick={() => {
                setShowResetModal(true);
                setResetStep(0);
              }}
              className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center justify-center transition-colors font-bold"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Factory Reset
            </button>
          </div>
        </div>
      </div>

      {/* FACTORY RESET MODAL */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-xl transform transition-all">
            <div className="flex items-center justify-center mb-6">
              <div className="bg-red-100 p-3 rounded-full">
                <AlertTriangle className="h-8 w-8 text-red-600" />
              </div>
            </div>

            {resetStep === 0 && (
              <>
                <h3 className="text-xl font-bold text-center text-gray-900 mb-4">
                  Factory Reset Warning
                </h3>
                <p className="text-gray-600 text-center mb-6">
                  This action will permanently delete ALL data, including:
                  <br />• Chat History
                  <br />• Sessions
                  <br />• Datasets
                  <br />• Configurations (API Keys)
                  <br />
                  <br />
                  <b>You cannot undo this action.</b>
                </p>
                <div className="flex space-x-4">
                  <button
                    onClick={() => setShowResetModal(false)}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setResetStep(1)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                  >
                    I Understand
                  </button>
                </div>
              </>
            )}

            {resetStep === 1 && (
              <>
                <h3 className="text-xl font-bold text-center text-gray-900 mb-4">
                  Confirm Reset
                </h3>
                <p className="text-gray-600 text-center mb-4">
                  Type <b>reset-my-system</b> below to confirm.
                </p>
                <input
                  type="text"
                  value={resetConfirmationInput}
                  onChange={(e) => setResetConfirmationInput(e.target.value)}
                  className="w-full p-2 border border-red-300 rounded mb-6 text-center font-mono focus:ring-2 focus:ring-red-500 outline-none"
                  placeholder="Type here..."
                />
                <div className="flex space-x-4">
                  <button
                    onClick={() => setShowResetModal(false)}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (resetConfirmationInput === 'reset-my-system') {
                        setResetStep(2);
                      }
                    }}
                    disabled={resetConfirmationInput !== 'reset-my-system'}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </>
            )}

            {resetStep === 2 && (
              <>
                <h3 className="text-xl font-bold text-center text-red-600 mb-4">
                  FINAL CONFIRMATION
                </h3>
                <p className="text-gray-800 text-center mb-6 font-semibold">
                  Are you absolutely sure you want to wipe everything?
                </p>
                <div className="flex space-x-4">
                  <button
                    onClick={() => setShowResetModal(false)}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
                  >
                    NO, Cancel
                  </button>
                  <button
                    onClick={handleFactoryReset}
                    disabled={isResetting}
                    className="flex-1 px-4 py-2 bg-red-700 text-white rounded hover:bg-red-800 transition-colors flex justify-center items-center"
                  >
                    {isResetting ? 'Wiping...' : 'YES, WIPE ALL'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* WIPE DATA SETS MODAL */}
      {showWipeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-center mb-6">
              <div className="bg-orange-100 p-3 rounded-full">
                <AlertTriangle className="h-8 w-8 text-orange-600" />
              </div>
            </div>

            {!wipeResult ? (
              <>
                <h3 className="text-xl font-bold text-center text-gray-900 mb-2">
                  Wipe Data Sets content
                </h3>
                <p className="text-sm text-gray-600 text-center mb-4">
                  Deletes everything in the Knowledge / Commands / Links / Mega
                  Text / AI Personality / Skills / Forms tabs.
                  <br />
                  <br />
                  <b>Preserved:</b> bot runtime config (HELP_MESSAGE,
                  AI_PERSONALITY config key, JOB_TYPES, COUNTRIES, …), CRM
                  contacts, leads, chat history, and the LID→phone mapping.
                </p>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm with your admin password
                </label>
                <input
                  type="password"
                  value={wipePassword}
                  onChange={(e) => setWipePassword(e.target.value)}
                  className="w-full p-2 border border-orange-300 rounded mb-6 focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="Admin password"
                  autoFocus
                  disabled={wiping}
                />
                <div className="flex space-x-4">
                  <button
                    onClick={() => {
                      setShowWipeModal(false);
                      setWipePassword('');
                    }}
                    disabled={wiping}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleWipeDatasets}
                    disabled={wiping || !wipePassword}
                    className="flex-1 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 transition-colors flex justify-center items-center"
                  >
                    {wiping ? 'Wiping…' : 'Wipe now'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold text-center text-green-700 mb-4">
                  Done
                </h3>
                <p className="text-center text-gray-700 mb-2">
                  Deleted <b>{wipeResult.totalDeleted}</b> row(s).
                </p>
                <ul className="text-xs text-gray-600 bg-gray-50 rounded p-3 mb-4 font-mono">
                  {Object.entries(wipeResult.deleted || {}).map(([k, v]) => (
                    <li key={k}>
                      {k}: <b>{String(v)}</b>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    setShowWipeModal(false);
                    setWipeResult(null);
                  }}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
