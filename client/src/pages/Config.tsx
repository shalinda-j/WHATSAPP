import { useState, useEffect, useCallback } from 'react';
import { api } from '../config';
import SystemHealthPanel from '../components/config/SystemHealthPanel';
import {
  Plus,
  Trash,
  Edit,
  Save,
  X,
  Bot,
  Settings,
  Activity,
  Cpu,
  Mic,
  RefreshCw,
  Calendar,
  Clock,
  TrendingUp,
  AlertCircle,
  DollarSign,
  Zap,
  Link2,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  Wand2,
  Eye,
  EyeOff,
  Copy,
} from 'lucide-react';

const IMAGE_PROVIDER_TYPES = ['image-openai', 'image-stability'] as const;
type ImageProviderType = (typeof IMAGE_PROVIDER_TYPES)[number];
const isImageProviderType = (t?: string): t is ImageProviderType =>
  !!t && (IMAGE_PROVIDER_TYPES as readonly string[]).includes(t);

const IMAGE_PROVIDER_META: Record<
  ImageProviderType,
  {
    label: string;
    defaultModel: string;
    modelPlaceholder: string;
    apiKeyPlaceholder: string;
    docsUrl: string;
    docsLabel: string;
  }
> = {
  'image-openai': {
    label: 'OpenAI (DALL-E / gpt-image-1)',
    defaultModel: 'gpt-image-1',
    modelPlaceholder: 'gpt-image-1, dall-e-3',
    apiKeyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'OpenAI API keys',
  },
  'image-stability': {
    label: 'Stability AI (SDXL)',
    defaultModel: 'stable-diffusion-xl-1024-v1-0',
    modelPlaceholder: 'stable-diffusion-xl-1024-v1-0',
    apiKeyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.stability.ai/account/keys',
    docsLabel: 'Stability AI keys',
  },
};

interface Config {
  _id: string;
  key: string;
  value: string;
  description?: string;
  isProvider?: boolean;
  providerType?: string;
  apiKey?: string;
  hasApiKey?: boolean;
  /** Masked stand-in, e.g. `sk-••••a3f9`. The real key never arrives via GET. */
  apiKeyPreview?: string;
  aiModel?: string;
  baseUrl?: string;
  usageLimit?: number;
  usageUsed?: number;
  costPerToken?: number;
  monthlyBudget?: number;
  isActive?: boolean;
  usagePeriodStart?: string;
  lastResetAt?: string;
}

interface UsageCycle {
  periodStart: string;
  periodEnd: string;
  nextReset: string;
  daysRemaining: number;
  daysElapsed: number;
  totalDays: number;
  progressPct: number;
}

interface VoiceConfigData {
  provider:
    | 'google-free'
    | 'google-cloud'
    | 'gemini-tts'
    | 'openai'
    | 'elevenlabs'
    | 'openrouter';
  apiKey?: string;
  hasApiKey?: boolean;
  googleApiKey?: string;
  hasGoogleApiKey?: boolean;
  voiceId?: string;
  isActive?: boolean;
  mode: 'voice-only' | 'text-only' | 'voice-and-text';
  // Free-form: OpenAI/ElevenLabs use fixed slugs, but OpenRouter accepts any
  // namespaced model (e.g. "openai/gpt-4o-mini-tts", "google/gemini-...-tts").
  ttsModel?: string;
}

// Helper to extract error message from axios errors
const getErrorMessage = (err: unknown): string => {
  if (err && typeof err === 'object' && 'response' in err) {
    const axiosErr = err as {
      response?: {
        data?: { message?: string; error?: string };
        status?: number;
      };
    };
    if (axiosErr.response?.data?.message) {
      return axiosErr.response.data.message;
    }
    if (axiosErr.response?.data?.error) {
      return axiosErr.response.data.error;
    }
    if (axiosErr.response?.status === 503) {
      return 'Database not connected. Please check if MongoDB is running or check server logs for IP whitelist issues.';
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Unknown error';
};

export default function Config() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'general' | 'ai' | 'image' | 'voice'
  >('ai');

  // Usage Cycle State
  const [usageCycle, setUsageCycle] = useState<UsageCycle | null>(null);
  const [resettingAll, setResettingAll] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);

  // Kiosk Voice Consultant provider preference (Config row key === KIOSK_AI_PROVIDER)
  const [kioskProvider, setKioskProvider] = useState<string>('');
  const [kioskSaving, setKioskSaving] = useState(false);
  const [kioskSaved, setKioskSaved] = useState(false);

  // Voice Config State
  const [voiceConfigs, setVoiceConfigs] = useState<VoiceConfigData[]>([]);
  const [activeVoiceProvider, setActiveVoiceProvider] =
    useState<string>('google-free');
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Session-Based (Unofficial) Connect Modal State
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionProvider, setSessionProvider] = useState<
    'openai-session' | 'claude-session'
  >('openai-session');
  const [sessionToken, setSessionToken] = useState('');
  const [sessionModel, setSessionModel] = useState('');
  const [sessionTesting, setSessionTesting] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionResult, setSessionResult] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const openSessionModal = (provider: 'openai-session' | 'claude-session') => {
    setSessionProvider(provider);
    setSessionToken('');
    setSessionModel(
      provider === 'openai-session'
        ? 'text-davinci-002-render-sha'
        : 'claude-3-5-sonnet-20241022',
    );
    setSessionResult(null);
    setSessionModalOpen(true);
  };

  // Catch obvious mistakes BEFORE we hit the network. Each provider has a
  // distinctive cookie shape, so a wrong-shape paste almost always means
  // the user copied something else (the whole document.cookie blob, a
  // bearer token, an API key, etc.). The backend would still reject these
  // with 400 but the round-trip wastes seconds and the user only sees a
  // generic "400 Bad Request" in the console.
  const validateCookieShape = (
    token: string,
    provider: 'openai-session' | 'claude-session',
  ): string | null => {
    const t = token.trim();
    if (!t) return 'Paste your session cookie first';
    if (t.length < 20) {
      return 'That looks too short to be a session cookie. Make sure you copied the whole value.';
    }
    if (t.includes(' ') || t.includes('\n')) {
      return 'Cookie should be a single value with no spaces or line breaks. Paste just the cookie value, not the whole document.cookie string.';
    }
    if (t.startsWith('sk-') && provider === 'openai-session') {
      return 'That looks like an OpenAI API key, not a session cookie. To use API keys, close this modal and add an "OpenAI" provider in the Providers list (NOT the "Session" option).';
    }
    // NOTE: do NOT hard-block on a specific prefix for ChatGPT. OpenAI issues
    // both JWT (eyJ...) and opaque (e.g. QACO...) session tokens depending on
    // the account/region — the old `!startsWith('ey')` check rejected valid
    // new cookies. Let the server be the source of truth via /session/test.
    if (provider === 'claude-session' && !t.startsWith('sk-ant-sid01-')) {
      return 'Claude session cookies start with "sk-ant-sid01-". Get it from claude.ai -> F12 -> Application -> Cookies -> sessionKey.';
    }
    return null;
  };

  const testSession = async () => {
    const shapeError = validateCookieShape(sessionToken, sessionProvider);
    if (shapeError) {
      setSessionResult({ type: 'error', text: `❌ ${shapeError}` });
      return;
    }
    setSessionTesting(true);
    setSessionResult(null);
    try {
      const res = await api.post('/api/config/session/test', {
        providerType: sessionProvider,
        sessionToken: sessionToken.trim(),
      });
      if (res.data?.valid) {
        const info = res.data.info || {};
        const label =
          sessionProvider === 'openai-session'
            ? `OpenAI session valid${info.email ? ` (${info.email})` : ''}`
            : `Claude session valid${
                info.organizationName ? ` (${info.organizationName})` : ''
              }${info.isPro ? ' — Pro account ✨' : ''}`;
        setSessionResult({ type: 'success', text: `✅ ${label}` });
      } else {
        setSessionResult({
          type: 'error',
          text: `❌ ${res.data?.error || 'Invalid session'}`,
        });
      }
    } catch (err: unknown) {
      setSessionResult({
        type: 'error',
        text: `❌ Test failed: ${getErrorMessage(err)}`,
      });
    } finally {
      setSessionTesting(false);
    }
  };

  const saveSession = async () => {
    const shapeError = validateCookieShape(sessionToken, sessionProvider);
    if (shapeError) {
      setSessionResult({ type: 'error', text: `❌ ${shapeError}` });
      return;
    }
    setSessionSaving(true);
    setSessionResult(null);
    try {
      await api.post('/api/config/session/save', {
        providerType: sessionProvider,
        sessionToken: sessionToken.trim(),
        model: sessionModel.trim() || undefined,
        isActive: true,
      });
      setSessionResult({
        type: 'success',
        text: '✅ Connected and activated!',
      });
      await fetchConfigs();
      setTimeout(() => setSessionModalOpen(false), 1200);
    } catch (err: unknown) {
      setSessionResult({
        type: 'error',
        text: `❌ Save failed: ${getErrorMessage(err)}`,
      });
    } finally {
      setSessionSaving(false);
    }
  };

  // Default form data
  const [formData, setFormData] = useState<Partial<Config>>({
    key: '',
    value: '',
    description: '',
    isProvider: false,
    providerType: 'openai',
    apiKey: '',
    aiModel: '',
    baseUrl: '',
    isActive: false,
  });

  /**
   * The stored API key, once the operator has explicitly asked to see it.
   * Null means "not revealed" — which is the state every time the dialog
   * opens, so a key is never left sitting on screen from a previous edit.
   */
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  /**
   * Drop the revealed key the moment the dialog closes, by whichever of the
   * several close paths (Cancel, the X, a successful save). Clearing it in each
   * handler instead would leave a plaintext provider secret in React state the
   * first time somebody added a fourth way out of this dialog.
   */
  useEffect(() => {
    if (!isEditing) {
      setRevealedKey(null);
      setRevealError(null);
    }
  }, [isEditing]);

  const fetchUsageCycle = useCallback(async () => {
    try {
      const res = await api.get('/api/config/usage-cycle');
      setUsageCycle(res.data);
    } catch {
      // Non-critical — use client-side fallback
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const periodStart = new Date(year, month, 1);
      const periodEnd = new Date(year, month + 1, 0, 23, 59, 59);
      const nextReset = new Date(year, month + 1, 1);
      const totalMs = periodEnd.getTime() - periodStart.getTime();
      const elapsed = now.getTime() - periodStart.getTime();
      const totalDays = Math.ceil(totalMs / 86400000);
      const daysElapsed = Math.floor(elapsed / 86400000);
      const daysRemaining = Math.ceil(
        (periodEnd.getTime() - now.getTime()) / 86400000,
      );
      setUsageCycle({
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        nextReset: nextReset.toISOString(),
        daysRemaining,
        daysElapsed,
        totalDays,
        progressPct: Math.min(100, Math.round((elapsed / totalMs) * 100)),
      });
    }
  }, []);

  const handleResetAll = async () => {
    if (
      !confirm(
        'Reset ALL provider token usage to 0 for this month? This cannot be undone.',
      )
    )
      return;
    setResettingAll(true);
    try {
      await api.post('/api/config/reset-usage');
      await fetchConfigs();
    } catch {
      alert('Reset failed — check server connection');
    } finally {
      setResettingAll(false);
    }
  };

  const handleResetSingle = async (id: string, name: string) => {
    if (!confirm(`Reset token usage for "${name}"?`)) return;
    setResettingId(id);
    try {
      await api.post(`/api/config/${id}/reset-usage`);
      await fetchConfigs();
    } catch {
      alert('Reset failed — check server connection');
    } finally {
      setResettingId(null);
    }
  };

  const fetchConfigs = async () => {
    try {
      const res = await api.get('/api/config');
      if (Array.isArray(res.data)) {
        setConfigs(res.data);
      } else {
        console.error('Expected array but got:', res.data);
        setConfigs([]);
      }
    } catch (error) {
      console.error('Failed to fetch configs', error);
      // Show user-friendly message for 503 errors
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosErr = error as { response?: { status?: number } };
        if (axiosErr.response?.status === 503) {
          console.error('Database not connected. Check MongoDB connection.');
        }
      }
    }
  };

  // Fetch Voice Configurations
  const fetchVoiceConfig = async () => {
    setVoiceLoading(true);
    try {
      const res = await api.get('/api/voice-config');
      const data = Array.isArray(res.data) ? res.data : [res.data];
      setVoiceConfigs(data);

      // Determine active provider by most recent updatedAt (which is how the backend sorts them)
      if (data.length > 0) {
        setActiveVoiceProvider(data[0].provider);
      }
    } catch (error) {
      console.error('Failed to fetch voice config', error);
    } finally {
      setVoiceLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchVoiceConfig();
    fetchUsageCycle();
  }, [fetchUsageCycle]);

  // Seed the kiosk provider dropdown from the persisted KIOSK_AI_PROVIDER row
  // whenever configs are (re)loaded. "" / absent = Auto (default chain).
  useEffect(() => {
    const row = configs.find((c) => c.key === 'KIOSK_AI_PROVIDER');
    setKioskProvider(row?.value || '');
  }, [configs]);

  // Upsert the kiosk provider preference: PUT when the row already exists,
  // POST when it doesn't. Leaves all other provider management untouched.
  const handleKioskProviderChange = async (value: string) => {
    setKioskProvider(value);
    setKioskSaving(true);
    setKioskSaved(false);
    try {
      const existing = configs.find((c) => c.key === 'KIOSK_AI_PROVIDER');
      if (existing) {
        await api.put(`/api/config/${existing._id}`, { value });
      } else {
        await api.post('/api/config', {
          key: 'KIOSK_AI_PROVIDER',
          value,
          isProvider: false,
          description: 'AI provider for the branch Voice Consultant kiosk',
        });
      }
      await fetchConfigs();
      setKioskSaved(true);
      setTimeout(() => setKioskSaved(false), 2500);
    } catch (err: unknown) {
      console.error('Failed to save kiosk provider:', err);
      alert('Failed to save kiosk provider: ' + getErrorMessage(err));
    } finally {
      setKioskSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this configuration?')) {
      try {
        await api.delete(`/api/config/${id}`);
        fetchConfigs();
        alert('Configuration deleted successfully.');
      } catch (error: unknown) {
        console.error('Failed to delete config:', error);
        alert(`Failed to delete configuration: ${getErrorMessage(error)}`);
      }
    }
  };

  const handleEdit = (c: Config) => {
    setFormData(c);
    setEditingId(c._id);
    setIsEditing(true);
    // The key is never in `c` — GET redacts it. Start from the masked preview
    // and let the operator ask for the real one.
    setRevealedKey(null);
    setRevealError(null);
  };

  /**
   * Fetch the stored key in the clear.
   *
   * A POST, not a GET: the server only audits mutating methods, and reading a
   * provider secret should leave a record of who did it. That also means this
   * must stay an explicit click — never something the dialog does on open.
   */
  const handleRevealKey = async () => {
    if (!editingId) return;
    setRevealing(true);
    setRevealError(null);
    try {
      const res = await api.post(`/api/config/${editingId}/reveal-key`);
      setRevealedKey(res.data?.apiKey ?? '');
    } catch (err: unknown) {
      setRevealError(getErrorMessage(err));
    } finally {
      setRevealing(false);
    }
  };

  const handleCreate = () => {
    const isImage = activeTab === 'image';
    const isAi = activeTab === 'ai';
    setFormData({
      key: '',
      value: '',
      description: '',
      isProvider: isAi || isImage,
      providerType: isImage ? 'image-openai' : 'openai',
      aiModel: isImage ? IMAGE_PROVIDER_META['image-openai'].defaultModel : '',
      baseUrl: '',
      isActive: false,
      usageLimit: isImage ? 0 : 1000000,
      costPerToken: isImage ? 0 : 0.000002,
    });
    setEditingId(null);
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      // Create a copy to avoid mutating state directly
      const payload = { ...formData };
      // For AI providers, key should be unique, so we generate one if not set
      if (payload.isProvider && !payload.key) {
        payload.key = `provider_${payload.providerType}_${Date.now()}`;
      }

      if (editingId) {
        await api.put(`/api/config/${editingId}`, payload);
      } else {
        await api.post('/api/config', payload);
      }
      setIsEditing(false);
      fetchConfigs();
    } catch (err: unknown) {
      console.error('Failed to save config:', err);
      alert('Error saving: ' + getErrorMessage(err));
    }
  };

  const handleSaveVoiceProvider = async (providerName: string) => {
    setVoiceSaving(true);
    setVoiceMessage(null);
    try {
      const base = voiceConfigs.find((c) => c.provider === providerName) || {
        provider: providerName as VoiceConfigData['provider'],
        mode: 'voice-and-text' as const,
      };
      await api.post('/api/voice-config', base);
      const label: Record<string, string> = {
        'google-free': 'Google Free TTS',
        'google-cloud': 'Google Cloud TTS',
        'gemini-tts': 'Gemini TTS',
        openai: 'OpenAI TTS',
        elevenlabs: 'ElevenLabs',
        openrouter: 'OpenRouter TTS',
      };
      setVoiceMessage({
        type: 'success',
        text: `✅ ${
          label[providerName] || providerName
        } activated! The system will auto-fallback to the next provider if this one is unavailable.`,
      });
      fetchVoiceConfig();
    } catch (error) {
      console.error('Failed to save config', error);
      setVoiceMessage({
        type: 'error',
        text: `Failed to save ${providerName} configuration.`,
      });
    } finally {
      setVoiceSaving(false);
    }
  };

  const updateProviderConfig = (
    providerName: string,
    updates: Partial<VoiceConfigData>,
  ) => {
    setVoiceConfigs((prev) => {
      const exists = prev.find((c) => c.provider === providerName);
      if (exists) {
        return prev.map((c) =>
          c.provider === providerName ? { ...c, ...updates } : c,
        );
      } else {
        return [
          ...prev,
          {
            provider: providerName as VoiceConfigData['provider'],
            mode: 'voice-and-text' as const,
            ...updates,
          },
        ];
      }
    });
  };

  const getProviderConfig = (providerName: string): VoiceConfigData => {
    const found = voiceConfigs.find((c) => c.provider === providerName);
    if (found) return found;

    return {
      provider: providerName as VoiceConfigData['provider'],
      mode: 'voice-and-text',
      apiKey: '',
      googleApiKey: '',
      ttsModel:
        providerName === 'elevenlabs'
          ? 'eleven_multilingual_v2'
          : providerName === 'openrouter'
            ? 'openai/gpt-4o-mini-tts'
            : 'tts-1',
      voiceId:
        providerName === 'google-cloud'
          ? 'en-US-Neural2-F'
          : providerName === 'gemini-tts'
            ? 'Kore'
            : providerName === 'elevenlabs'
              ? ''
              : providerName === 'openrouter'
                ? 'alloy'
                : 'nova',
    };
  };

  const generalConfigs = configs.filter((c) => !c.isProvider);
  const aiConfigs = configs.filter(
    (c) => c.isProvider && !isImageProviderType(c.providerType),
  );
  const imageConfigs = configs.filter(
    (c) => c.isProvider && isImageProviderType(c.providerType),
  );

  if (isEditing) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-md max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">
            {editingId ? 'Edit Config' : 'New Config'}
          </h2>
          <button
            onClick={() => setIsEditing(false)}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Toggle between General and AI (only for new items) */}
          {!editingId && (
            <div className="flex space-x-4 mb-4">
              <button
                onClick={() => setFormData({ ...formData, isProvider: false })}
                className={`px-4 py-2 rounded-lg ${
                  !formData.isProvider
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100'
                }`}
              >
                General Config
              </button>
              <button
                onClick={() => setFormData({ ...formData, isProvider: true })}
                className={`px-4 py-2 rounded-lg ${
                  formData.isProvider
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100'
                }`}
              >
                AI Provider
              </button>
            </div>
          )}

          {formData.isProvider ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Provider
                </label>
                <select
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={formData.providerType}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setFormData((prev) => {
                      // When switching INTO an image provider, suggest its
                      // default model so the operator doesn't have to look it up.
                      // Only auto-fill if the field is empty so we never
                      // clobber a deliberately set value.
                      const auto =
                        isImageProviderType(nextType) && !prev.aiModel
                          ? IMAGE_PROVIDER_META[nextType as ImageProviderType]
                              .defaultModel
                          : prev.aiModel;
                      return {
                        ...prev,
                        providerType: nextType,
                        aiModel: auto,
                      };
                    });
                  }}
                >
                  <optgroup label="Chat / LLM">
                    <option value="openai">OpenAI (GPT)</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="google">Google (Gemini)</option>
                    <option value="groq">Groq</option>
                    <option value="openrouter">
                      OpenRouter (Multi-Provider)
                    </option>
                    <option value="local">Local (Ollama/LM Studio)</option>
                    <option value="custom">
                      Custom (any OpenAI-compatible endpoint)
                    </option>
                  </optgroup>
                  <optgroup label="Voice / TTS">
                    <option value="openrouter-tts">
                      OpenRouter TTS (Voice Consultant)
                    </option>
                  </optgroup>
                  <optgroup label="Image generation">
                    {IMAGE_PROVIDER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {IMAGE_PROVIDER_META[t].label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {isImageProviderType(formData.providerType) && (
                  <p className="mt-1 text-xs text-gray-500">
                    Stored as an active image-gen credential. Content Studio
                    will use it the moment <strong>Active</strong> is enabled.
                    <a
                      href={
                        IMAGE_PROVIDER_META[
                          formData.providerType as ImageProviderType
                        ].docsUrl
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline ml-1"
                    >
                      {
                        IMAGE_PROVIDER_META[
                          formData.providerType as ImageProviderType
                        ].docsLabel
                      }{' '}
                      →
                    </a>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  API Key
                </label>
                {/* Editing a provider that already has a key.
                    The field itself has to stay empty-means-unchanged (the
                    server preserves the stored key on a blank save), but an
                    empty box with a "sk-..." placeholder looks exactly like a
                    provider with NO key — which is what made this form read as
                    broken. So the stored key is shown here instead, masked
                    until asked for. */}
                {editingId && formData.hasApiKey && (
                  <div className="mt-1 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                    <code className="flex-1 min-w-0 break-all font-mono text-xs text-gray-700">
                      {revealedKey ?? formData.apiKeyPreview ?? '••••'}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        revealedKey ? setRevealedKey(null) : handleRevealKey()
                      }
                      disabled={revealing}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                      title={
                        revealedKey
                          ? 'Hide the key again'
                          : 'Show the stored key (recorded in the audit log)'
                      }
                    >
                      {revealing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : revealedKey ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                      {revealedKey ? 'Hide' : 'Show'}
                    </button>
                    {revealedKey && (
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard?.writeText(revealedKey)
                        }
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                        title="Copy to clipboard"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                    )}
                  </div>
                )}
                {revealError && (
                  <p className="mb-2 text-xs text-red-600">
                    Could not read the key: {revealError}
                  </p>
                )}
                <input
                  type="password"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={formData.apiKey || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, apiKey: e.target.value })
                  }
                  placeholder={
                    editingId && formData.hasApiKey
                      ? 'Leave blank to keep the key above'
                      : isImageProviderType(formData.providerType)
                        ? IMAGE_PROVIDER_META[
                            formData.providerType as ImageProviderType
                          ].apiKeyPlaceholder
                        : 'sk-...'
                  }
                />
                {editingId && formData.hasApiKey && (
                  <p className="mt-1 text-xs text-gray-500">
                    Type here only to replace it — saving an empty box keeps the
                    current key.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Model Name
                </label>
                <input
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={formData.aiModel || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, aiModel: e.target.value })
                  }
                  placeholder={
                    isImageProviderType(formData.providerType)
                      ? IMAGE_PROVIDER_META[
                          formData.providerType as ImageProviderType
                        ].modelPlaceholder
                      : formData.providerType === 'openrouter'
                        ? 'e.g. openai/gpt-4o, anthropic/claude-3-opus'
                        : 'e.g. gpt-4-turbo'
                  }
                />
                {formData.providerType === 'openrouter' && (
                  <p className="mt-1 text-xs text-gray-500">
                    Format: provider/model-name.
                    <a
                      href="https://openrouter.ai/models"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline ml-1"
                    >
                      Browse models →
                    </a>
                  </p>
                )}
                {formData.providerType === 'openrouter-tts' && (
                  <p className="mt-1 text-xs text-gray-500">
                    OpenRouter TTS model used by the AI Voice Consultant
                    (kiosk). e.g. <code>openai/gpt-4o-mini-tts</code>. Leave the
                    API Key blank to reuse your OpenRouter chat provider&apos;s
                    key.
                  </p>
                )}
              </div>
              {formData.providerType === 'openrouter-tts' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Voice
                  </label>
                  <input
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={formData.value || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, value: e.target.value })
                    }
                    placeholder="e.g. alloy, verse, shimmer"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    The spoken voice for the Voice Consultant. Defaults to{' '}
                    <code>alloy</code> when blank.
                  </p>
                </div>
              )}
              {(formData.providerType === 'custom' ||
                formData.providerType === 'local') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Base URL
                  </label>
                  <input
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={formData.baseUrl || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, baseUrl: e.target.value })
                    }
                    placeholder={
                      formData.providerType === 'local'
                        ? 'e.g. http://localhost:11434/v1'
                        : 'e.g. https://api.together.xyz/v1'
                    }
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    The OpenAI-compatible endpoint. Works with Ollama, vLLM, LM
                    Studio, Together.ai, DeepInfra, Fireworks, DeepSeek,
                    Mistral, Grok, or any private gateway. Must end in{' '}
                    <code>/v1</code>.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Cost per Token ($)
                  </label>
                  <input
                    type="number"
                    step="0.0000001"
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={formData.costPerToken || 0}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        costPerToken: parseFloat(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Monthly Token Limit
                  </label>
                  <input
                    type="number"
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={formData.usageLimit || 0}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        usageLimit: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Monthly Budget ($){' '}
                  <span className="text-gray-400 font-normal">
                    (optional cost cap)
                  </span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={formData.monthlyBudget || 0}
                  placeholder="e.g. 10.00"
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      monthlyBudget: parseFloat(e.target.value),
                    })
                  }
                />
                <p className="text-xs text-gray-500 mt-1">
                  Shows a warning badge on the card when estimated cost exceeds
                  this amount.
                </p>
              </div>
              <div className="flex items-center pt-2">
                <input
                  type="checkbox"
                  id="isActive"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  checked={formData.isActive || false}
                  onChange={(e) =>
                    setFormData({ ...formData, isActive: e.target.checked })
                  }
                />
                <label
                  htmlFor="isActive"
                  className="ml-2 block text-sm text-gray-900"
                >
                  Set as Active Provider
                </label>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Key
                </label>
                <input
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={formData.key}
                  disabled={!!editingId}
                  onChange={(e) =>
                    setFormData({ ...formData, key: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Value
                </label>
                <input
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={formData.value}
                  onChange={(e) =>
                    setFormData({ ...formData, value: e.target.value })
                  }
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              value={formData.description || ''}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
            />
          </div>

          <div className="flex justify-end pt-4">
            <button
              onClick={() => setIsEditing(false)}
              className="mr-3 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <Save className="h-4 w-4 mr-2" /> Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Configuration</h1>
        <button
          onClick={handleCreate}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          <Plus className="h-5 w-5 mr-2" /> Add New
        </button>
      </div>

      <SystemHealthPanel />

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          className={`py-2 px-4 font-medium text-sm ${
            activeTab === 'ai'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('ai')}
        >
          <div className="flex items-center">
            <Bot className="w-4 h-4 mr-2" /> AI Providers
          </div>
        </button>
        <button
          className={`py-2 px-4 font-medium text-sm ${
            activeTab === 'image'
              ? 'border-b-2 border-purple-500 text-purple-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('image')}
        >
          <div className="flex items-center">
            <Wand2 className="w-4 h-4 mr-2" /> Image Providers
            {imageConfigs.length > 0 && (
              <span
                className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  activeTab === 'image'
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {imageConfigs.length}
              </span>
            )}
          </div>
        </button>
        <button
          className={`py-2 px-4 font-medium text-sm ${
            activeTab === 'general'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('general')}
        >
          <div className="flex items-center">
            <Settings className="w-4 h-4 mr-2" /> General Settings
          </div>
        </button>
        <button
          className={`py-2 px-4 font-medium text-sm ${
            activeTab === 'voice'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('voice')}
        >
          <div className="flex items-center">
            <Mic className="w-4 h-4 mr-2" /> Voice Provider
          </div>
        </button>
      </div>

      {activeTab === 'ai' && (
        <div className="space-y-6">
          {/* ── Monthly Cycle Banner ─────────────────────────────── */}
          {usageCycle && (
            <div className="bg-gradient-to-r from-indigo-600 to-purple-700 rounded-2xl p-5 text-white shadow-lg">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Period info */}
                <div className="flex items-start gap-4">
                  <div className="p-2.5 bg-white/20 rounded-xl">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-indigo-200 font-medium uppercase tracking-wider">
                      Current Billing Period
                    </p>
                    <p className="text-xl font-bold mt-0.5">
                      {new Date(usageCycle.periodStart).toLocaleDateString(
                        'en-US',
                        { month: 'long', day: 'numeric' },
                      )}{' '}
                      &ndash;{' '}
                      {new Date(usageCycle.periodEnd).toLocaleDateString(
                        'en-US',
                        { month: 'long', day: 'numeric', year: 'numeric' },
                      )}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <span className="flex items-center gap-1 text-indigo-200">
                        <Clock className="h-3.5 w-3.5" />
                        {usageCycle.daysElapsed} of {usageCycle.totalDays} days
                        used
                      </span>
                      <span className="flex items-center gap-1 text-indigo-200">
                        <Zap className="h-3.5 w-3.5" />
                        {usageCycle.daysRemaining} days remaining
                      </span>
                    </div>
                  </div>
                </div>

                {/* Next reset */}
                <div className="flex flex-col items-end gap-2">
                  <div className="text-right">
                    <p className="text-xs text-indigo-200 uppercase tracking-wider">
                      Next Auto-Reset
                    </p>
                    <p className="font-bold text-lg">
                      {new Date(usageCycle.nextReset).toLocaleDateString(
                        'en-US',
                        { month: 'short', day: 'numeric', year: 'numeric' },
                      )}
                    </p>
                    <p className="text-xs text-indigo-200">
                      at 00:00 AM (midnight)
                    </p>
                  </div>
                  <button
                    onClick={handleResetAll}
                    disabled={resettingAll}
                    className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 border border-white/30 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${
                        resettingAll ? 'animate-spin' : ''
                      }`}
                    />
                    {resettingAll ? 'Resetting...' : 'Reset All Now'}
                  </button>
                </div>
              </div>

              {/* Period progress bar */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-indigo-200 mb-1">
                  <span>Period Progress</span>
                  <span>{usageCycle.progressPct}%</span>
                </div>
                <div className="w-full bg-white/20 rounded-full h-2">
                  <div
                    className="bg-white h-2 rounded-full transition-all"
                    style={{ width: `${usageCycle.progressPct}%` }}
                  />
                </div>
              </div>

              {/* Total cost across all providers */}
              {aiConfigs.length > 0 && (
                <div className="mt-4 flex items-center gap-6 text-sm border-t border-white/20 pt-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-indigo-200" />
                    <span className="text-indigo-200">
                      Total Tokens This Month:
                    </span>
                    <span className="font-bold">
                      {aiConfigs
                        .reduce((s, c) => s + (c.usageUsed || 0), 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-indigo-200" />
                    <span className="text-indigo-200">Total Est. Cost:</span>
                    <span className="font-bold">
                      $
                      {aiConfigs
                        .reduce(
                          (s, c) =>
                            s + (c.usageUsed || 0) * (c.costPerToken || 0),
                          0,
                        )
                        .toFixed(4)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Kiosk Voice Consultant provider ──────────────────── */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-100 rounded-xl">
                <Mic className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-800">
                  Kiosk Voice Consultant provider
                </h3>
                <p className="text-sm text-gray-600 mt-0.5">
                  Choose which AI provider powers the branch Voice Consultant
                  kiosk. Leave on <strong>Auto</strong> to use the default
                  fallback chain.
                </p>
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  <select
                    value={kioskProvider}
                    onChange={(e) => handleKioskProviderChange(e.target.value)}
                    disabled={kioskSaving}
                    className="block w-full max-w-md px-3 py-2 border border-gray-300 rounded-md disabled:opacity-50"
                  >
                    <option value="">Auto (default chain)</option>
                    {aiConfigs.map((c) => (
                      <option key={c._id} value={c.providerType}>
                        {(c.providerType || 'unknown') +
                          ' · ' +
                          (c.aiModel || 'no model')}
                      </option>
                    ))}
                  </select>
                  {kioskSaving && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                    </span>
                  )}
                  {kioskSaved && !kioskSaving && (
                    <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Quick Connect: Unofficial Session-Based Providers ───── */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-xl">
                <ShieldAlert className="h-5 w-5 text-amber-700" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-800">
                  Quick Connect Your Account{' '}
                  <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full ml-1">
                    BETA
                  </span>
                </h3>
                <p className="text-sm text-amber-800 mt-0.5">
                  Use your existing ChatGPT / Claude account directly — no API
                  key needed. Used as <strong>fallback only</strong> after
                  official APIs. <strong>Risk:</strong> account may get banned.
                  Use a throwaway account.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* OpenAI Quick Connect */}
              {(() => {
                const cfg = aiConfigs.find(
                  (c) => c.providerType === 'openai-session',
                );
                return (
                  <div
                    className={`bg-white rounded-xl border-2 p-4 ${
                      cfg?.isActive ? 'border-green-400' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white text-xs font-bold">
                          AI
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800">
                            ChatGPT Account
                          </p>
                          <p className="text-[11px] text-gray-500">
                            via session cookie
                          </p>
                        </div>
                      </div>
                      {cfg?.isActive && (
                        <span className="text-[10px] bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> CONNECTED
                        </span>
                      )}
                      {cfg && !cfg.isActive && (
                        <span className="text-[10px] bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">
                          EXPIRED
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => openSessionModal('openai-session')}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-900 hover:bg-black text-white rounded-lg text-sm font-medium transition"
                    >
                      <Link2 className="h-4 w-4" />
                      {cfg ? 'Reconnect / Update' : 'Connect ChatGPT'}
                    </button>
                  </div>
                );
              })()}

              {/* Claude Quick Connect */}
              {(() => {
                const cfg = aiConfigs.find(
                  (c) => c.providerType === 'claude-session',
                );
                return (
                  <div
                    className={`bg-white rounded-xl border-2 p-4 ${
                      cfg?.isActive ? 'border-green-400' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                          C
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800">
                            Claude Account
                          </p>
                          <p className="text-[11px] text-gray-500">
                            via session cookie
                          </p>
                        </div>
                      </div>
                      {cfg?.isActive && (
                        <span className="text-[10px] bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> CONNECTED
                        </span>
                      )}
                      {cfg && !cfg.isActive && (
                        <span className="text-[10px] bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">
                          EXPIRED
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => openSessionModal('claude-session')}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition"
                    >
                      <Link2 className="h-4 w-4" />
                      {cfg ? 'Reconnect / Update' : 'Connect Claude'}
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── AI Provider Cards ────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {aiConfigs.map((c) => {
              const used = c.usageUsed || 0;
              const limit = c.usageLimit || 0;
              const costPerToken = c.costPerToken || 0;
              const estCost = used * costPerToken;
              const budget = c.monthlyBudget || 0;
              const usagePct =
                limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              const costPct =
                budget > 0
                  ? Math.min(100, Math.round((estCost / budget) * 100))
                  : 0;
              const isOverBudget = budget > 0 && estCost > budget;
              const isNearLimit = limit > 0 && usagePct >= 80;

              const providerLabel = c.providerType
                ? c.providerType.charAt(0).toUpperCase() +
                  c.providerType.slice(1)
                : 'Unknown';

              return (
                <div
                  key={c._id}
                  className={`bg-white rounded-2xl shadow border-2 overflow-hidden ${
                    c.isActive ? 'border-green-500' : 'border-gray-100'
                  }`}
                >
                  {/* Card header */}
                  <div
                    className={`px-5 py-4 flex justify-between items-center ${
                      c.isActive ? 'bg-green-50' : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-xl ${
                          c.isActive
                            ? 'bg-green-100 text-green-600'
                            : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        <Cpu className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-gray-800">
                            {providerLabel}
                          </h3>
                          {c.isActive && (
                            <span className="flex items-center gap-1 text-xs text-green-600 font-medium bg-green-100 px-2 py-0.5 rounded-full">
                              <Activity className="h-3 w-3" /> Active
                            </span>
                          )}
                          {isNearLimit && !isOverBudget && (
                            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                              Near Limit
                            </span>
                          )}
                          {isOverBudget && (
                            <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">
                              <AlertCircle className="h-3 w-3" /> Over Budget
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {c.aiModel || 'No model set'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleResetSingle(c._id, providerLabel)}
                        disabled={resettingId === c._id}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                        title="Reset usage for this provider"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${
                            resettingId === c._id ? 'animate-spin' : ''
                          }`}
                        />
                      </button>
                      <button
                        onClick={() => handleEdit(c)}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(c._id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="px-5 py-4 space-y-4">
                    {/* Token usage */}
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                          <Zap className="h-3.5 w-3.5 text-indigo-500" />
                          Token Usage This Month
                        </span>
                        <span className="text-xs text-gray-500">
                          {used.toLocaleString()}{' '}
                          {limit > 0 && `/ ${limit.toLocaleString()}`}
                        </span>
                      </div>
                      {limit > 0 ? (
                        <>
                          <div className="w-full bg-gray-100 rounded-full h-2.5">
                            <div
                              className={`h-2.5 rounded-full transition-all ${
                                usagePct >= 90
                                  ? 'bg-red-500'
                                  : usagePct >= 80
                                    ? 'bg-amber-500'
                                    : 'bg-indigo-500'
                              }`}
                              style={{ width: `${usagePct}%` }}
                            />
                          </div>
                          <p className="text-right text-[10px] text-gray-400 mt-0.5">
                            {usagePct}% of limit
                          </p>
                        </>
                      ) : (
                        <div className="text-xs text-gray-400 italic">
                          No token limit set — unlimited
                        </div>
                      )}
                    </div>

                    {/* Estimated cost */}
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                          <DollarSign className="h-3.5 w-3.5 text-green-500" />
                          Estimated Cost
                        </span>
                        <span
                          className={`text-sm font-bold ${
                            isOverBudget ? 'text-red-600' : 'text-gray-800'
                          }`}
                        >
                          ${estCost.toFixed(4)}
                        </span>
                      </div>
                      {budget > 0 ? (
                        <>
                          <div className="w-full bg-gray-100 rounded-full h-2.5">
                            <div
                              className={`h-2.5 rounded-full transition-all ${
                                isOverBudget
                                  ? 'bg-red-500'
                                  : costPct >= 80
                                    ? 'bg-amber-500'
                                    : 'bg-green-500'
                              }`}
                              style={{ width: `${Math.min(100, costPct)}%` }}
                            />
                          </div>
                          <p className="text-right text-[10px] text-gray-400 mt-0.5">
                            ${estCost.toFixed(4)} of ${budget.toFixed(2)} budget
                          </p>
                        </>
                      ) : (
                        <div className="text-xs text-gray-400 italic">
                          No monthly budget set
                        </div>
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-[11px] text-gray-400">
                      <span>
                        {c.lastResetAt
                          ? `Last reset: ${new Date(
                              c.lastResetAt,
                            ).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}`
                          : 'Never reset'}
                      </span>
                      <span>${(costPerToken * 1000).toFixed(5)}/1K tokens</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {aiConfigs.length === 0 && (
              <div className="col-span-2 text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300">
                <Cpu className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">
                  No AI providers configured
                </p>
                <p className="text-gray-400 text-sm mt-1">
                  Click "Add New" to set up OpenAI, Gemini, Groq, etc.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'image' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-white rounded-lg shadow-sm">
                <Wand2 className="h-5 w-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">
                  Image generation providers
                </h3>
                <p className="text-sm text-gray-700 mt-1">
                  Plug an API key in here and Content Studio + every agent's
                  image-generation calls pick it up immediately — no environment
                  variable, no restart. Stored encrypted via CryptoService.
                </p>
                <button
                  onClick={() => {
                    setFormData({
                      key: '',
                      value: '',
                      description: '',
                      isProvider: true,
                      providerType: 'image-openai',
                      apiKey: '',
                      aiModel: IMAGE_PROVIDER_META['image-openai'].defaultModel,
                      isActive: true,
                    });
                    setEditingId(null);
                    setIsEditing(true);
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-sm font-semibold rounded-md hover:bg-purple-700"
                >
                  <Plus className="h-4 w-4" /> Connect image provider
                </button>
              </div>
            </div>
          </div>

          {imageConfigs.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-gray-300 rounded-xl bg-white">
              <Wand2 className="h-10 w-10 mx-auto text-gray-300 mb-2" />
              <p className="text-sm font-medium text-gray-700">
                No image providers connected yet
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Click <em>Connect image provider</em> above to add an OpenAI or
                Stability key.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {imageConfigs.map((c) => {
                const meta = isImageProviderType(c.providerType)
                  ? IMAGE_PROVIDER_META[c.providerType as ImageProviderType]
                  : null;
                return (
                  <div
                    key={c._id}
                    className={`rounded-xl border p-4 shadow-sm bg-white ${
                      c.isActive
                        ? 'border-purple-300 ring-1 ring-purple-200'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Wand2 className="h-4 w-4 text-purple-600" />
                          <h4 className="font-semibold text-gray-900 truncate">
                            {meta?.label ?? c.providerType ?? c.key}
                          </h4>
                        </div>
                        <p className="text-xs text-gray-600 font-mono">
                          model: {c.aiModel || meta?.defaultModel || '—'}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          c.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                      <span className="text-xs text-gray-500 inline-flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3" /> Key:{' '}
                        {c.hasApiKey || c.apiKey
                          ? 'set (encrypted)'
                          : 'missing'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(c)}
                          className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
                        >
                          <Edit className="h-3 w-3" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(c._id)}
                          className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1"
                        >
                          <Trash className="h-3 w-3" /> Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'general' && (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Key
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Value
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {generalConfigs.map((c) => (
                  <tr key={c._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {c.key}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 break-all max-w-xs truncate">
                      {c.value}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {c.description}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEdit(c)}
                        className="text-indigo-600 hover:text-indigo-900 mr-4"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(c._id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <Trash className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {generalConfigs.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              No general configs found.
            </div>
          )}
        </div>
      )}

      {activeTab === 'voice' && (
        <div className="max-w-4xl mx-auto">
          {voiceLoading ? (
            <div className="p-12 text-center text-gray-500">
              Loading voice configuration...
            </div>
          ) : (
            <>
              {voiceMessage && (
                <div
                  className={`p-4 rounded mb-6 ${
                    voiceMessage.type === 'success'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {voiceMessage.text}
                </div>
              )}

              {/* Waterfall routing info banner */}
              <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-900">
                <p className="font-semibold mb-1">📡 Smart Waterfall Routing</p>
                <p>
                  The system auto-falls back to the next provider if the active
                  one fails. Recommended order:{' '}
                  <strong>
                    Gemini TTS → Google Cloud TTS → OpenAI TTS → ElevenLabs →
                    Google Free TTS
                  </strong>
                  . <strong>Gemini TTS</strong> is the only AI-powered engine
                  that natively supports{' '}
                  <strong>Sinhala, Tamil, Hindi, and English</strong> using the
                  same Gemini API Key — no extra setup needed.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Google Free TTS Card */}
                <div
                  className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${
                    activeVoiceProvider === 'google-free'
                      ? 'border-green-500 shadow-green-100'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-gray-800">
                        Google Free TTS
                      </h3>
                      <p className="text-xs text-gray-500">
                        Free · Sinhala / Tamil / English
                      </p>
                    </div>
                    {activeVoiceProvider === 'google-free' && (
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                        <Activity className="w-3 h-3 mr-1" /> Active
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Response Mode
                      </label>
                      <select
                        value={getProviderConfig('google-free').mode}
                        onChange={(e) =>
                          updateProviderConfig('google-free', {
                            mode: e.target.value as VoiceConfigData['mode'],
                          })
                        }
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:outline-none"
                      >
                        <option value="voice-and-text">Voice & Text</option>
                        <option value="voice-only">Voice Only</option>
                        <option value="text-only">Text Only</option>
                      </select>
                    </div>
                    <div className="bg-green-50 p-3 rounded text-sm text-green-800 border border-green-100">
                      ✅ No API Key required. Uses the free Google TTS package.
                      The <strong>only</strong> engine that supports Sinhala —
                      automatically selected for Sinhala voice replies.
                    </div>
                  </div>
                  <button
                    onClick={() => handleSaveVoiceProvider('google-free')}
                    disabled={voiceSaving}
                    className="mt-6 w-full flex items-center justify-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-black transition disabled:opacity-50"
                  >
                    <Save className="h-4 w-4 mr-2" /> Save & Activate
                  </button>
                </div>

                {/* Google Cloud TTS Card */}
                <div
                  className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${
                    activeVoiceProvider === 'google-cloud'
                      ? 'border-blue-500 shadow-blue-100'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-gray-800">
                        Google Cloud TTS
                      </h3>
                      <p className="text-xs text-gray-500">
                        Neural2 Voices · English, Tamil, Hindi
                      </p>
                    </div>
                    {activeVoiceProvider === 'google-cloud' && (
                      <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                        <Activity className="w-3 h-3 mr-1" /> Active
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Response Mode
                      </label>
                      <select
                        value={getProviderConfig('google-cloud').mode}
                        onChange={(e) =>
                          updateProviderConfig('google-cloud', {
                            mode: e.target.value as VoiceConfigData['mode'],
                          })
                        }
                        className="w-full p-2 border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="voice-and-text">Voice & Text</option>
                        <option value="voice-only">Voice Only</option>
                        <option value="text-only">Text Only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-blue-900 mb-1">
                        Google Cloud API Key
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Create at <strong>console.cloud.google.com</strong> →
                        APIs &amp; Services → Credentials → Create API Key.
                        Enable <em>Cloud Text-to-Speech API</em> in your
                        project.
                      </p>
                      <input
                        type="password"
                        value={
                          getProviderConfig('google-cloud').googleApiKey || ''
                        }
                        onChange={(e) =>
                          updateProviderConfig('google-cloud', {
                            googleApiKey: e.target.value,
                          })
                        }
                        placeholder="AIza..."
                        className="w-full p-2 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-blue-900 mb-1">
                        Neural2 Voice
                      </label>
                      <select
                        value={
                          getProviderConfig('google-cloud').voiceId ||
                          'en-US-Neural2-F'
                        }
                        onChange={(e) =>
                          updateProviderConfig('google-cloud', {
                            voiceId: e.target.value,
                          })
                        }
                        className="w-full p-2 text-sm border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="en-US-Neural2-F">
                          English — Neural2-F (Female)
                        </option>
                        <option value="en-US-Neural2-D">
                          English — Neural2-D (Male)
                        </option>
                        <option value="en-US-Neural2-A">
                          English — Neural2-A (Male)
                        </option>
                        <option value="ta-IN-Neural2-B">
                          Tamil — Neural2-B (Female)
                        </option>
                        <option value="ta-IN-Neural2-A">
                          Tamil — Neural2-A (Male)
                        </option>
                        <option value="hi-IN-Neural2-A">
                          Hindi — Neural2-A (Female)
                        </option>
                        <option value="hi-IN-Neural2-B">
                          Hindi — Neural2-B (Male)
                        </option>
                      </select>
                    </div>
                    <div className="bg-blue-50 p-3 rounded text-xs text-blue-700 border border-blue-100">
                      ⚠️ Sinhala is <strong>not supported</strong> by Google
                      Cloud TTS — Sinhala replies automatically use Google Free
                      TTS regardless of this setting.
                    </div>
                  </div>
                  <button
                    onClick={() => handleSaveVoiceProvider('google-cloud')}
                    disabled={voiceSaving}
                    className="mt-6 w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    <Save className="h-4 w-4 mr-2" /> Save & Activate
                  </button>
                </div>

                {/* Gemini TTS Card */}
                <div
                  className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${
                    activeVoiceProvider === 'gemini-tts'
                      ? 'border-indigo-500 shadow-indigo-100'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-gray-800">
                        Gemini TTS
                      </h3>
                      <p className="text-xs text-gray-500">
                        AI-Powered · 100+ Languages · Sinhala Native
                      </p>
                    </div>
                    {activeVoiceProvider === 'gemini-tts' && (
                      <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                        <Activity className="w-3 h-3 mr-1" /> Active
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Response Mode
                      </label>
                      <select
                        value={getProviderConfig('gemini-tts').mode}
                        onChange={(e) =>
                          updateProviderConfig('gemini-tts', {
                            mode: e.target.value as VoiceConfigData['mode'],
                          })
                        }
                        className="w-full p-2 border border-indigo-200 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      >
                        <option value="voice-and-text">Voice & Text</option>
                        <option value="voice-only">Voice Only</option>
                        <option value="text-only">Text Only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-indigo-900 mb-1">
                        Voice
                      </label>
                      <select
                        value={
                          getProviderConfig('gemini-tts').voiceId || 'Kore'
                        }
                        onChange={(e) =>
                          updateProviderConfig('gemini-tts', {
                            voiceId: e.target.value,
                          })
                        }
                        className="w-full p-2 border border-indigo-200 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm"
                      >
                        <option value="Kore">Kore — Firm (English)</option>
                        <option value="Puck">Puck — Upbeat</option>
                        <option value="Charon">Charon — Informative</option>
                        <option value="Fenrir">Fenrir — Excitable</option>
                        <option value="Aoede">Aoede — Breezy</option>
                        <option value="Leda">Leda — Youthful (Tamil)</option>
                        <option value="Achird">
                          Achird — Friendly (Hindi)
                        </option>
                        <option value="Sulafat">
                          Sulafat — Warm (Sinhala/Tamil/Hindi)
                        </option>
                        <option value="Zephyr">Zephyr — Bright</option>
                        <option value="Umbriel">Umbriel — Easy-going</option>
                        <option value="Iapetus">Iapetus — Clear</option>
                        <option value="Gacrux">Gacrux — Mature</option>
                        <option value="Achernar">Achernar — Soft</option>
                        <option value="Alnilam">Alnilam — Firm</option>
                      </select>
                    </div>
                    <div className="bg-indigo-50 p-3 rounded text-xs text-indigo-800 border border-indigo-100">
                      🤖 Uses{' '}
                      <strong>model gemini-2.5-flash-preview-tts</strong> —
                      powered by your existing <strong>Gemini API Key</strong>{' '}
                      (no extra setup). Natively speaks Sinhala, Tamil, Hindi,
                      English and 100+ languages. Recommended:{' '}
                      <em>Sulafat (Warm)</em> for multilingual use.
                    </div>
                  </div>
                  <button
                    onClick={() => handleSaveVoiceProvider('gemini-tts')}
                    disabled={voiceSaving}
                    className="mt-6 w-full flex items-center justify-center px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition disabled:opacity-50"
                  >
                    <Save className="h-4 w-4 mr-2" /> Save & Activate
                  </button>
                </div>

                {/* OpenAI TTS Card */}
                <div
                  className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${
                    activeVoiceProvider === 'openai'
                      ? 'border-green-500 shadow-green-100'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-gray-800">
                        OpenAI Voice
                      </h3>
                      <p className="text-xs text-gray-500">
                        High Quality · Lifelike Speech
                      </p>
                    </div>
                    {activeVoiceProvider === 'openai' && (
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                        <Activity className="w-3 h-3 mr-1" /> Active
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Response Mode
                      </label>
                      <select
                        value={getProviderConfig('openai').mode}
                        onChange={(e) =>
                          updateProviderConfig('openai', {
                            mode: e.target.value as VoiceConfigData['mode'],
                          })
                        }
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:outline-none"
                      >
                        <option value="voice-and-text">Voice & Text</option>
                        <option value="voice-only">Voice Only</option>
                        <option value="text-only">Text Only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={getProviderConfig('openai').apiKey || ''}
                        onChange={(e) =>
                          updateProviderConfig('openai', {
                            apiKey: e.target.value,
                          })
                        }
                        placeholder="sk-..."
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Quality
                        </label>
                        <select
                          value={
                            getProviderConfig('openai').ttsModel || 'tts-1'
                          }
                          onChange={(e) =>
                            updateProviderConfig('openai', {
                              ttsModel: e.target
                                .value as VoiceConfigData['ttsModel'],
                            })
                          }
                          className="w-full p-1.5 text-sm border border-gray-300 rounded"
                        >
                          <option value="tts-1">Standard</option>
                          <option value="tts-1-hd">HD</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Persona
                        </label>
                        <select
                          value={getProviderConfig('openai').voiceId || 'nova'}
                          onChange={(e) =>
                            updateProviderConfig('openai', {
                              voiceId: e.target.value,
                            })
                          }
                          className="w-full p-1.5 text-sm border border-gray-300 rounded"
                        >
                          <option value="alloy">Alloy (Neutral)</option>
                          <option value="echo">Echo (Male)</option>
                          <option value="fable">Fable (Neutral)</option>
                          <option value="onyx">Onyx (Male)</option>
                          <option value="nova">Nova (Female)</option>
                          <option value="shimmer">Shimmer (Female)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSaveVoiceProvider('openai')}
                    disabled={voiceSaving}
                    className="mt-6 w-full flex items-center justify-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-black transition disabled:opacity-50"
                  >
                    <Save className="h-4 w-4 mr-2" /> Save & Activate
                  </button>
                </div>

                {/* ElevenLabs Card */}
                <div
                  className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${
                    activeVoiceProvider === 'elevenlabs'
                      ? 'border-purple-500 shadow-purple-100'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-gray-800">
                        ElevenLabs
                      </h3>
                      <p className="text-xs text-gray-500">
                        Premium · Voice Cloning
                      </p>
                    </div>
                    {activeVoiceProvider === 'elevenlabs' && (
                      <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                        <Activity className="w-3 h-3 mr-1" /> Active
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Response Mode
                      </label>
                      <select
                        value={getProviderConfig('elevenlabs').mode}
                        onChange={(e) =>
                          updateProviderConfig('elevenlabs', {
                            mode: e.target.value as VoiceConfigData['mode'],
                          })
                        }
                        className="w-full p-2 border border-purple-200 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      >
                        <option value="voice-and-text">Voice & Text</option>
                        <option value="voice-only">Voice Only</option>
                        <option value="text-only">Text Only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-purple-900 mb-2">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={getProviderConfig('elevenlabs').apiKey || ''}
                        onChange={(e) =>
                          updateProviderConfig('elevenlabs', {
                            apiKey: e.target.value,
                          })
                        }
                        placeholder="API Key"
                        className="w-full p-2 border border-purple-200 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-purple-900 mb-2">
                        Engine Model
                      </label>
                      <select
                        value={
                          getProviderConfig('elevenlabs').ttsModel ||
                          'eleven_multilingual_v2'
                        }
                        onChange={(e) =>
                          updateProviderConfig('elevenlabs', {
                            ttsModel: e.target
                              .value as VoiceConfigData['ttsModel'],
                          })
                        }
                        className="w-full p-2 border border-purple-200 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      >
                        <option value="eleven_multilingual_v2">
                          Multilingual v2
                        </option>
                        <option value="eleven_monolingual_v1">
                          Monolingual v1
                        </option>
                        <option value="eleven_turbo_v2">Turbo v2</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-purple-900 mb-2">
                        Voice Clone ID
                      </label>
                      <input
                        value={getProviderConfig('elevenlabs').voiceId || ''}
                        onChange={(e) =>
                          updateProviderConfig('elevenlabs', {
                            voiceId: e.target.value,
                          })
                        }
                        placeholder="e.g. pNInz6obpg"
                        className="w-full p-2 border border-purple-200 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => handleSaveVoiceProvider('elevenlabs')}
                    disabled={voiceSaving}
                    className="mt-6 w-full flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    <Save className="h-4 w-4 mr-2" /> Save & Activate
                  </button>
                </div>

                {/* OpenRouter TTS Card */}
                <div
                  className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${
                    activeVoiceProvider === 'openrouter'
                      ? 'border-indigo-500 shadow-indigo-100'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-gray-800">
                        OpenRouter TTS
                      </h3>
                      <p className="text-xs text-gray-500">
                        Any OpenRouter voice model · reuses your chat key
                      </p>
                    </div>
                    {activeVoiceProvider === 'openrouter' && (
                      <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                        <Activity className="w-3 h-3 mr-1" /> Active
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Response Mode
                      </label>
                      <select
                        value={getProviderConfig('openrouter').mode}
                        onChange={(e) =>
                          updateProviderConfig('openrouter', {
                            mode: e.target.value as VoiceConfigData['mode'],
                          })
                        }
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      >
                        <option value="voice-and-text">Voice & Text</option>
                        <option value="voice-only">Voice Only</option>
                        <option value="text-only">Text Only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        API Key{' '}
                        <span className="text-xs font-normal text-gray-400">
                          (optional — falls back to your OpenRouter chat key)
                        </span>
                      </label>
                      <input
                        type="password"
                        value={getProviderConfig('openrouter').apiKey || ''}
                        onChange={(e) =>
                          updateProviderConfig('openrouter', {
                            apiKey: e.target.value,
                          })
                        }
                        placeholder="sk-or-v1-…"
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        TTS Model
                      </label>
                      <input
                        type="text"
                        value={
                          getProviderConfig('openrouter').ttsModel ||
                          'openai/gpt-4o-mini-tts'
                        }
                        onChange={(e) =>
                          updateProviderConfig('openrouter', {
                            ttsModel: e.target.value,
                          })
                        }
                        placeholder="openai/gpt-4o-mini-tts"
                        className="w-full p-2 border border-gray-300 rounded font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        Any OpenRouter audio/speech model slug, e.g.{' '}
                        <code>openai/gpt-4o-mini-tts</code> or{' '}
                        <code>google/gemini-2.5-flash-tts-preview</code>.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Voice
                      </label>
                      <input
                        type="text"
                        value={
                          getProviderConfig('openrouter').voiceId || 'alloy'
                        }
                        onChange={(e) =>
                          updateProviderConfig('openrouter', {
                            voiceId: e.target.value,
                          })
                        }
                        placeholder="alloy"
                        className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => handleSaveVoiceProvider('openrouter')}
                    disabled={voiceSaving}
                    className="mt-6 w-full flex items-center justify-center px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition disabled:opacity-50"
                  >
                    <Save className="h-4 w-4 mr-2" /> Save & Activate
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Session Connect Modal (OpenAI / Claude Quick Connect) ───── */}
      {sessionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div
              className={`px-6 py-4 flex items-center justify-between border-b ${
                sessionProvider === 'openai-session'
                  ? 'bg-gray-900 text-white'
                  : 'bg-orange-600 text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Link2 className="h-5 w-5" />
                <div>
                  <h3 className="font-bold text-lg">
                    Connect{' '}
                    {sessionProvider === 'openai-session'
                      ? 'ChatGPT'
                      : 'Claude'}{' '}
                    Account
                  </h3>
                  <p className="text-xs opacity-80">
                    Paste your browser session cookie
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSessionModalOpen(false)}
                className="p-1 hover:bg-white/10 rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Warning */}
              <div className="flex gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>Use a throwaway account.</strong> This is an
                  unofficial method that violates{' '}
                  {sessionProvider === 'openai-session'
                    ? 'OpenAI'
                    : 'Anthropic'}{' '}
                  ToS. Your account may get banned. Cookies expire every{' '}
                  {sessionProvider === 'openai-session'
                    ? '~7 days'
                    : '~30 days'}{' '}
                  — you&apos;ll need to repeat this then.
                  <span className="block mt-1.5">
                    ⚠️ This often <strong>fails from a hosted server</strong>{' '}
                    (Cloudflare blocks data-center IPs). For reliable replies,
                    use an official API-key provider (Gemini / Groq / OpenAI) or
                    a <strong>Custom</strong> OpenAI-compatible endpoint
                    instead.
                  </span>
                </div>
              </div>

              {/* Step-by-step guide */}
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <p className="font-semibold text-blue-900 mb-2 text-sm">
                  📋 How to copy your cookie:
                </p>
                <ol className="list-decimal ml-5 text-sm text-blue-900 space-y-1.5">
                  {sessionProvider === 'openai-session' ? (
                    <>
                      <li>
                        Open{' '}
                        <a
                          href="https://chatgpt.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline font-medium"
                        >
                          chatgpt.com
                        </a>{' '}
                        and log in.
                      </li>
                      <li>
                        Press{' '}
                        <kbd className="px-1.5 py-0.5 bg-white border border-blue-300 rounded text-xs">
                          F12
                        </kbd>{' '}
                        to open DevTools.
                      </li>
                      <li>
                        Go to <strong>Application</strong> tab →{' '}
                        <strong>Cookies</strong> →{' '}
                        <code className="bg-white px-1 rounded">
                          https://chatgpt.com
                        </code>
                      </li>
                      <li>
                        Find{' '}
                        <code className="bg-white px-1 rounded">
                          __Secure-next-auth.session-token
                        </code>{' '}
                        and copy its <strong>Value</strong>.
                      </li>
                      <li>
                        Paste it below — copy the <strong>whole</strong> value
                        (it may start with{' '}
                        <code className="bg-white px-1 rounded">eyJ…</code> or
                        be an opaque string).
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        Open{' '}
                        <a
                          href="https://claude.ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline font-medium"
                        >
                          claude.ai
                        </a>{' '}
                        and log in.
                      </li>
                      <li>
                        Press{' '}
                        <kbd className="px-1.5 py-0.5 bg-white border border-blue-300 rounded text-xs">
                          F12
                        </kbd>{' '}
                        to open DevTools.
                      </li>
                      <li>
                        Go to <strong>Application</strong> tab →{' '}
                        <strong>Cookies</strong> →{' '}
                        <code className="bg-white px-1 rounded">
                          https://claude.ai
                        </code>
                      </li>
                      <li>
                        Find{' '}
                        <code className="bg-white px-1 rounded">
                          sessionKey
                        </code>{' '}
                        and copy its <strong>Value</strong>.
                      </li>
                      <li>
                        Paste it below. (String starting with{' '}
                        <code className="bg-white px-1 rounded">
                          sk-ant-sid01-...
                        </code>
                        )
                      </li>
                    </>
                  )}
                </ol>
              </div>

              {/* Token paste */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Session Cookie Value
                </label>
                <textarea
                  value={sessionToken}
                  onChange={(e) => setSessionToken(e.target.value)}
                  placeholder={
                    sessionProvider === 'openai-session'
                      ? 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..._very_long_string'
                      : 'sk-ant-sid01-...'
                  }
                  rows={3}
                  className="w-full p-2 border border-gray-300 rounded-lg font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Model selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <select
                  value={sessionModel}
                  onChange={(e) => setSessionModel(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {sessionProvider === 'openai-session' ? (
                    <>
                      <option value="text-davinci-002-render-sha">
                        GPT-3.5 (free tier)
                      </option>
                      <option value="gpt-4">GPT-4 (Plus subscription)</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo (Plus)</option>
                      <option value="gpt-4o">GPT-4o (Plus)</option>
                    </>
                  ) : (
                    <>
                      <option value="claude-3-5-sonnet-20241022">
                        Claude 3.5 Sonnet
                      </option>
                      <option value="claude-3-opus-20240229">
                        Claude 3 Opus (Pro)
                      </option>
                      <option value="claude-3-haiku-20240307">
                        Claude 3 Haiku
                      </option>
                    </>
                  )}
                </select>
              </div>

              {/* Result */}
              {sessionResult && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    sessionResult.type === 'success'
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {sessionResult.text}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-end gap-2 rounded-b-2xl">
              <button
                onClick={() => setSessionModalOpen(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={testSession}
                disabled={
                  sessionTesting || sessionSaving || !sessionToken.trim()
                }
                className="flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {sessionTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Test Connection
              </button>
              <button
                onClick={saveSession}
                disabled={
                  sessionSaving || sessionTesting || !sessionToken.trim()
                }
                className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 ${
                  sessionProvider === 'openai-session'
                    ? 'bg-gray-900 hover:bg-black'
                    : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {sessionSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Connect & Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
