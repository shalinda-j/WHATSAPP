import { useState, useEffect } from 'react';
import { api } from '../config';
import { Link } from 'react-router-dom';
import TelephonyProvidersSection from '../components/voice/TelephonyProvidersSection';
import LiveCallSettingsSection from '../components/voice/LiveCallSettingsSection';
import {
  AudioLines,
  Bot,
  Database,
  Users,
  Activity,
  CheckCircle2,
  XCircle,
  ChevronRight,
  MessageCircle,
  Settings,
  Mic,
  Volume2,
  VolumeX,
  RefreshCw,
  AlertCircle,
  X,
  Phone,
  Play,
  Info,
  Zap,
  Loader2,
  Headphones,
} from 'lucide-react';

// Types
interface VoiceConfigData {
  _id?: string;
  provider:
    'google-free' | 'google-cloud' | 'gemini-tts' | 'openai' | 'elevenlabs';
  apiKey?: string;
  googleApiKey?: string;
  /**
   * The server redacts stored keys: GET returns these booleans instead of the
   * raw values, so "is this provider configured?" must be read from them and
   * only fall back to the (legacy) raw fields.
   */
  hasApiKey?: boolean;
  hasGoogleApiKey?: boolean;
  voiceId?: string;
  isActive: boolean;
  mode: 'voice-only' | 'text-only' | 'voice-and-text';
  ttsModel?: string;
  updatedAt?: Date;
}

interface AIProviderConfig {
  _id: string;
  key: string;
  isProvider: boolean;
  isActive: boolean;
  providerType: string;
  aiModel?: string;
}

interface DatasetItem {
  _id: string;
  name: string;
  type: string;
  entries: number;
}

interface LeadItem {
  _id: string;
  fullName: string;
  phoneNumber: string;
  jobVacancyType: string;
  status: string;
}

interface AnalyticsData {
  totalVoiceNotes: number;
  totalCallsRejected: number;
  voiceMessages?: number;
  totalMessages?: number;
  totalUsers?: number;
}

// Provider configuration metadata
const PROVIDER_INFO = {
  'google-free': {
    name: 'Google Free TTS',
    description: 'Unofficial · Sinhala / Tamil / English · No API key',
    color: 'green',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-500',
    textColor: 'text-green-600',
    ringColor: 'ring-green-400',
    buttonColor: 'bg-green-600 hover:bg-green-700',
    requiresApiKey: false,
    requiresGoogleApiKey: false,
    voices: [
      { id: 'en', name: 'English 🇬🇧' },
      { id: 'si', name: 'Sinhala 🇱🇰' },
      { id: 'ta', name: 'Tamil 🇮🇳' },
    ],
    note: 'Uses Google Translate TTS. Best for Sinhala (only engine with native si support). Free but rate-limited.',
  },
  'google-cloud': {
    name: 'Google Cloud TTS',
    description: 'Official Neural2 · EN & Tamil · Requires API Key',
    color: 'sky',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-500',
    textColor: 'text-sky-600',
    ringColor: 'ring-sky-400',
    buttonColor: 'bg-sky-600 hover:bg-sky-700',
    requiresApiKey: false,
    requiresGoogleApiKey: true,
    voices: [
      { id: 'en-US-Neural2-F', name: 'English — Neural2 Female 🇺🇸' },
      { id: 'en-US-Neural2-J', name: 'English — Neural2 Male 🇺🇸' },
      { id: 'ta-IN-Neural2-B', name: 'Tamil — Neural2 Female 🇮🇳' },
      { id: 'ta-IN-Wavenet-A', name: 'Tamil — WaveNet Female 🇮🇳' },
      { id: 'hi-IN-Neural2-A', name: 'Hindi — Neural2 Female 🇮🇳' },
    ],
    note: 'Official Google Cloud TTS. High quality Neural2 voices for English & Tamil. Sinhala auto-routes to Google Free (Google Cloud has no Sinhala voice).',
  },
  'gemini-tts': {
    name: 'Gemini TTS',
    description: 'AI-Powered · 100+ Languages · Uses Gemini API Key',
    color: 'indigo',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-500',
    textColor: 'text-indigo-600',
    ringColor: 'ring-indigo-400',
    buttonColor: 'bg-indigo-600 hover:bg-indigo-700',
    requiresApiKey: false,
    requiresGoogleApiKey: false,
    voices: [
      { id: 'Kore', name: 'Kore — Firm (EN)' },
      { id: 'Puck', name: 'Puck — Upbeat' },
      { id: 'Charon', name: 'Charon — Informative' },
      { id: 'Fenrir', name: 'Fenrir — Excitable' },
      { id: 'Aoede', name: 'Aoede — Breezy' },
      { id: 'Leda', name: 'Leda — Youthful' },
      { id: 'Achird', name: 'Achird — Friendly' },
      { id: 'Sulafat', name: 'Sulafat — Warm (SI/TA/HI)' },
      { id: 'Zephyr', name: 'Zephyr — Bright' },
      { id: 'Umbriel', name: 'Umbriel — Easy-going' },
      { id: 'Iapetus', name: 'Iapetus — Clear' },
      { id: 'Gacrux', name: 'Gacrux — Mature' },
      { id: 'Achernar', name: 'Achernar — Soft' },
      { id: 'Alnilam', name: 'Alnilam — Firm' },
    ],
    note: 'Gemini 2.5 Flash TTS. Uses your existing Gemini API Key — no extra setup needed. Natively supports Sinhala, Tamil, Hindi, English and 100+ more languages. Returns WAV audio.',
  },
  openai: {
    name: 'OpenAI TTS',
    description: 'tts-1 / tts-1-hd · High Quality · Requires API Key',
    color: 'blue',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-600',
    ringColor: 'ring-blue-400',
    buttonColor: 'bg-blue-600 hover:bg-blue-700',
    requiresApiKey: true,
    requiresGoogleApiKey: false,
    voices: [
      { id: 'nova', name: 'Nova (Warm Female)' },
      { id: 'shimmer', name: 'Shimmer (Gentle Female)' },
      { id: 'alloy', name: 'Alloy (Neutral)' },
      { id: 'echo', name: 'Echo (Male)' },
      { id: 'fable', name: 'Fable (British)' },
      { id: 'onyx', name: 'Onyx (Deep Male)' },
    ],
    note: 'Natural-sounding voices. Can speak English, Tamil, and Sinhala (with accent). Good fallback for Sinhala.',
  },
  elevenlabs: {
    name: 'ElevenLabs',
    description: 'Premium Voice Cloning · Multilingual · Requires API Key',
    color: 'purple',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-500',
    textColor: 'text-purple-600',
    ringColor: 'ring-purple-400',
    buttonColor: 'bg-purple-600 hover:bg-purple-700',
    requiresApiKey: true,
    requiresGoogleApiKey: false,
    voices: [],
    note: 'Best quality for multilingual voice. Supports voice cloning. Enter your ElevenLabs Voice ID.',
  },
};

export default function VoiceAgentHub() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // States representing the different modules
  const [voiceConfigs, setVoiceConfigs] = useState<VoiceConfigData[]>([]);
  const [activeVoiceConfig, setActiveVoiceConfig] =
    useState<VoiceConfigData | null>(null);
  const [globalConfig, setGlobalConfig] = useState<AIProviderConfig | null>(
    null,
  );
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalVoiceNotes: 0,
    totalCallsRejected: 0,
  });
  const [recentLeads, setRecentLeads] = useState<LeadItem[]>([]);

  // Edit mode for voice provider
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<VoiceConfigData>>(
    {},
  );
  const [showConfirmToggle, setShowConfirmToggle] = useState(false);
  const [pendingToggleState, setPendingToggleState] = useState<boolean | null>(
    null,
  );

  // Call Agent state
  const [callAgentEnabled, setCallAgentEnabled] = useState(false);
  const [callAgentLanguage, setCallAgentLanguage] = useState<
    'en' | 'si' | 'ta'
  >('en');
  const [callAgentGreeting, setCallAgentGreeting] = useState('');
  const [callAgentPersonality, setCallAgentPersonality] = useState('');
  const [callLogs, setCallLogs] = useState<
    Array<{
      callerId: string;
      createdAt: string;
      status: string;
      language: string;
    }>
  >([]);
  const [savingCallAgent, setSavingCallAgent] = useState(false);
  const [testingVoiceLang, setTestingVoiceLang] = useState<string | null>(null);
  const [testVoiceError, setTestVoiceError] = useState<string | null>(null);

  const fetchAllData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [
        voiceRes,
        configRes,
        datasetRes,
        analyticsRes,
        leadsRes,
        callAgentRes,
        callLogsRes,
      ] = await Promise.all([
        api.get('/api/voice-config').catch(() => ({ data: [] })),
        api.get('/api/config').catch(() => ({ data: [] })),
        api.get('/api/datasets').catch(() => ({ data: [] })),
        api.get('/api/analytics/overview').catch(() => ({ data: {} })),
        api.get('/api/leads?limit=5').catch(() => ({ data: { leads: [] } })),
        api.get('/api/call-agent/settings').catch(() => ({
          data: { enabled: false, language: 'en', greeting: '' },
        })),
        api
          .get('/api/call-agent/logs?limit=10')
          .catch(() => ({ data: { logs: [] } })),
      ]);

      const vData = Array.isArray(voiceRes.data)
        ? voiceRes.data
        : [voiceRes.data];
      setVoiceConfigs(vData);

      // Find the currently active config (where isActive is true)
      const activeConfig = vData.find(
        (c: VoiceConfigData) => c.isActive === true,
      );
      // If no active config, use the most recently updated one
      const sortedConfigs = [...vData].sort(
        (a, b) =>
          new Date(b.updatedAt || 0).getTime() -
          new Date(a.updatedAt || 0).getTime(),
      );
      setActiveVoiceConfig(activeConfig || sortedConfigs[0] || null);

      // Handle config as array
      const configs = Array.isArray(configRes.data) ? configRes.data : [];
      const activeAI = configs.find(
        (c: AIProviderConfig) => c.isActive && c.isProvider,
      );
      setGlobalConfig(activeAI || null);

      setDatasets(Array.isArray(datasetRes.data) ? datasetRes.data : []);
      setAnalytics(
        analyticsRes.data || { totalVoiceNotes: 0, totalCallsRejected: 0 },
      );
      setRecentLeads(leadsRes.data?.leads || []);

      // Call Agent data
      const caSettings = callAgentRes.data || {};
      setCallAgentEnabled(caSettings.enabled || false);
      setCallAgentLanguage(caSettings.language || 'en');
      setCallAgentGreeting(caSettings.greeting || '');
      setCallAgentPersonality(caSettings.personality || '');
      setCallLogs(callLogsRes.data?.logs || []);
    } catch (error) {
      console.error('Failed to load Hub data', error);
      setMessage({
        type: 'error',
        text: 'Failed to load data. Please try again.',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Auto-dismiss messages after 5 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Toggle Call Agent on/off and PERSIST immediately. Previously this only
  // flipped local state, so the change was lost on refresh (the toggle looked
  // like it worked but never reached the backend). Optimistic update with
  // revert-on-failure, matching the Voice Agent master toggle pattern.
  const toggleCallAgent = async () => {
    const next = !callAgentEnabled;
    setCallAgentEnabled(next); // optimistic
    try {
      await api.post('/api/call-agent/toggle', { enabled: next });
      setMessage({
        type: 'success',
        text: `Call Agent ${next ? 'enabled' : 'disabled'}.`,
      });
    } catch {
      setCallAgentEnabled(!next); // revert
      setMessage({ type: 'error', text: 'Failed to update Call Agent.' });
    }
  };

  // Save Call Agent settings
  const saveCallAgentSettings = async () => {
    setSavingCallAgent(true);
    try {
      await api.post('/api/call-agent/settings', {
        enabled: callAgentEnabled,
        language: callAgentLanguage,
        greeting: callAgentGreeting,
        personality: callAgentPersonality,
      });
      setMessage({ type: 'success', text: 'Call Agent settings saved!' });
      fetchAllData(true);
    } catch {
      setMessage({
        type: 'error',
        text: 'Failed to save Call Agent settings.',
      });
    } finally {
      setSavingCallAgent(false);
    }
  };

  // Test language greeting — calls Gemini TTS and plays back audio in the browser
  const testLanguageGreeting = async (lang: 'en' | 'si' | 'ta') => {
    setTestingVoiceLang(lang);
    setTestVoiceError(null);
    try {
      // Use the saved greeting text if available, else let backend use its default
      const textForLang =
        lang === callAgentLanguage ? callAgentGreeting : undefined;
      const res = await api.post('/api/call-agent/test-voice', {
        language: lang,
        text: textForLang || undefined,
      });
      const { audio, format } = res.data;
      if (!audio) throw new Error('No audio returned from server');

      // Decode base64 → Blob → Object URL → play
      const binary = atob(audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: format === 'wav' ? 'audio/wav' : 'audio/ogg',
      });
      const url = URL.createObjectURL(blob);
      const audioEl = new Audio(url);
      // Revoke exactly once on any terminal outcome so the blob URL never
      // leaks. Previously only onended revoked it, so an autoplay-blocked
      // play() rejection (the very case the catch handles) leaked the URL on
      // every test click.
      let revoked = false;
      const revoke = () => {
        if (revoked) return;
        revoked = true;
        URL.revokeObjectURL(url);
      };
      audioEl.play().catch(() => {
        setTestVoiceError(
          'Browser blocked autoplay — click "Allow" if prompted',
        );
        revoke();
      });
      audioEl.onended = revoke;
      audioEl.onerror = revoke;
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { error?: string } };
        message?: string;
      };
      const msg =
        axiosErr?.response?.data?.error ||
        axiosErr.message ||
        'TTS test failed';
      setTestVoiceError(msg);
    } finally {
      setTestingVoiceLang(null);
    }
  };

  // Toggle voice agent on/off globally (with confirmation for disable)
  const toggleVoiceAgent = async () => {
    if (showConfirmToggle && pendingToggleState !== null) {
      // User confirmed the toggle
      setShowConfirmToggle(false);
      await executeToggle(pendingToggleState);
    } else {
      const newIsActive = !(activeVoiceConfig?.isActive ?? true);
      if (!newIsActive) {
        // Show confirmation dialog for disabling
        setPendingToggleState(newIsActive);
        setShowConfirmToggle(true);
      } else {
        // Enable immediately without confirmation
        await executeToggle(newIsActive);
      }
    }
  };

  const executeToggle = async (newIsActive: boolean) => {
    setSaving(true);
    try {
      await api.post('/api/voice-config/toggle', { isActive: newIsActive });

      // Update local state
      setActiveVoiceConfig((prev) =>
        prev ? { ...prev, isActive: newIsActive } : null,
      );
      setVoiceConfigs((prev) =>
        prev.map((c) => ({ ...c, isActive: newIsActive })),
      );

      setMessage({
        type: 'success',
        text: `Voice Agent ${
          newIsActive ? 'enabled' : 'disabled'
        } successfully`,
      });
    } catch {
      setMessage({
        type: 'error',
        text: 'Failed to update voice agent status',
      });
    } finally {
      setSaving(false);
    }
  };

  // Save voice provider configuration
  const saveProviderConfig = async (providerName: string) => {
    const providerInfo =
      PROVIDER_INFO[providerName as keyof typeof PROVIDER_INFO];
    // A key is only required when the provider has NONE stored yet. The server
    // redacts stored keys on GET, so the edit field comes back empty for an
    // already-configured provider — requiring re-entry every save was the
    // regression. An empty field on an already-configured provider means
    // "keep the existing key".
    const existing = getProviderConfig(providerName);
    const hasKey = existing.hasApiKey ?? !!existing.apiKey;
    const hasGoogleKey = existing.hasGoogleApiKey ?? !!existing.googleApiKey;
    if (providerInfo.requiresApiKey && !editFormData.apiKey && !hasKey) {
      setMessage({
        type: 'error',
        text: `API Key is required for ${providerInfo.name}`,
      });
      return;
    }
    if (
      providerInfo.requiresGoogleApiKey &&
      !editFormData.googleApiKey &&
      !hasGoogleKey
    ) {
      setMessage({
        type: 'error',
        text: `Google Cloud API Key is required for ${providerInfo.name}`,
      });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const configToSave: VoiceConfigData = {
        provider: providerName as VoiceConfigData['provider'],
        mode: editFormData.mode || 'voice-and-text',
        voiceId: editFormData.voiceId,
        ttsModel: editFormData.ttsModel,
        isActive: true,
      };
      // Only send keys the operator actually typed. Sending an empty string
      // would overwrite (wipe) the stored key; omitting it preserves it.
      if (editFormData.apiKey) configToSave.apiKey = editFormData.apiKey;
      if (editFormData.googleApiKey)
        configToSave.googleApiKey = editFormData.googleApiKey;

      await api.post('/api/voice-config', configToSave);
      await fetchAllData();
      setEditingProvider(null);
      setMessage({
        type: 'success',
        text: `${providerInfo.name} activated successfully! The system will auto-route to next available provider if this one fails.`,
      });
    } catch {
      setMessage({
        type: 'error',
        text: `Failed to save ${providerName} configuration`,
      });
    } finally {
      setSaving(false);
    }
  };

  // Start editing a provider
  const startEditing = (provider: string) => {
    const existing = voiceConfigs.find((c) => c.provider === provider);
    setEditFormData(
      existing || {
        provider: provider as VoiceConfigData['provider'],
        mode: 'voice-and-text',
        apiKey: '',
        googleApiKey: '',
        voiceId:
          provider === 'google-cloud'
            ? 'en-US-Neural2-F'
            : provider === 'gemini-tts'
              ? 'Kore'
              : provider === 'elevenlabs'
                ? ''
                : 'nova',
        ttsModel:
          provider === 'elevenlabs' ? 'eleven_multilingual_v2' : 'tts-1',
      },
    );
    setEditingProvider(provider);
  };

  // Get provider config
  const getProviderConfig = (providerName: string): VoiceConfigData => {
    const found = voiceConfigs.find((c) => c.provider === providerName);
    if (found) return found;
    return {
      provider: providerName as VoiceConfigData['provider'],
      mode: 'voice-and-text',
      apiKey: '',
      googleApiKey: '',
      voiceId:
        providerName === 'google-cloud'
          ? 'en-US-Neural2-F'
          : providerName === 'gemini-tts'
            ? 'Kore'
            : providerName === 'elevenlabs'
              ? ''
              : 'nova',
      ttsModel:
        providerName === 'elevenlabs' ? 'eleven_multilingual_v2' : 'tts-1',
      isActive: false,
    };
  };

  // Whether a provider has a stored API key. The server REDACTS the key on
  // GET (returns a `hasApiKey` boolean, not the raw value), so checking
  // `.apiKey` alone always reads empty for a configured provider — falling back
  // to the raw field keeps older responses working.
  const providerHasApiKey = (providerName: string): boolean => {
    const c = getProviderConfig(providerName);
    return c.hasApiKey ?? !!c.apiKey;
  };

  // Get voice name by ID
  const getVoiceName = (provider: string, voiceId?: string): string => {
    if (!voiceId) return 'Not set';
    const providerInfo = PROVIDER_INFO[provider as keyof typeof PROVIDER_INFO];
    const voice = providerInfo?.voices.find((v) => v.id === voiceId);
    return voice?.name || voiceId;
  };

  // Format phone number for display
  const formatPhone = (phone: string): string => {
    if (!phone) return '';
    const cleaned = phone.replace('@s.whatsapp.net', '');
    return cleaned.startsWith('947') ? `+${cleaned}` : cleaned;
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600"></div>
        <p className="mt-4 text-gray-500">Loading Voice Agent Hub...</p>
      </div>
    );
  }

  const activeVoiceProvider = activeVoiceConfig?.provider || 'google-free';
  const voiceMode = activeVoiceConfig?.mode || 'voice-and-text';
  const isVoiceActive = activeVoiceConfig?.isActive ?? true;
  const activeAIProvider =
    globalConfig?.aiModel || globalConfig?.providerType || 'Not Configured';
  const activeProviderInfo =
    PROVIDER_INFO[activeVoiceProvider as keyof typeof PROVIDER_INFO];

  return (
    <div className="-m-4 sm:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto pb-8">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center">
              <div className="p-2.5 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-xl mr-3 shadow-md shadow-indigo-500/20">
                <AudioLines className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
              </div>
              Voice Agent Hub
            </h1>
            <p className="text-gray-500 mt-2 ml-1 text-sm sm:text-base">
              Central command for your WhatsApp Voice AI infrastructure
            </p>
          </div>
          <button
            onClick={() => fetchAllData(true)}
            disabled={refreshing}
            className="flex items-center px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`}
            />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Notification Toast */}
        {message && (
          <div
            className={`fixed top-4 right-4 z-50 mb-6 p-4 rounded-lg shadow-lg flex items-center gap-3 max-w-md animate-slide-in ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : message.type === 'info'
                  ? 'bg-blue-50 text-blue-800 border border-blue-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
            ) : message.type === 'info' ? (
              <Info className="h-5 w-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
            )}
            <span className="flex-1">{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="p-1 hover:bg-black/10 rounded transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Confirmation Dialog */}
        {showConfirmToggle && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm mx-4 animate-scale-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-amber-100 rounded-full">
                  <AlertCircle className="h-6 w-6 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">
                  Disable Voice Agent?
                </h3>
              </div>
              <p className="text-gray-600 mb-6">
                The voice agent will stop responding to voice notes and calls.
                Users will not receive voice replies.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmToggle(false)}
                  className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={toggleVoiceAgent}
                  className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors"
                >
                  Disable
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Master Toggle & Stats Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Master Toggle Card */}
          <div
            className={`sm:col-span-2 p-6 rounded-xl shadow-lg text-white transition-all duration-300 relative overflow-hidden ${
              isVoiceActive
                ? 'bg-gradient-to-br from-indigo-600 via-purple-600 to-purple-700 shadow-indigo-500/20'
                : 'bg-gradient-to-br from-gray-600 to-gray-700'
            }`}
          >
            {/* Subtle decorative orb so the card has more visual weight */}
            <div
              aria-hidden
              className={`pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full blur-3xl transition-opacity ${
                isVoiceActive
                  ? 'bg-pink-400/30 opacity-100'
                  : 'bg-white/10 opacity-50'
              }`}
            />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center">
                <div
                  className={`p-3 rounded-lg mr-4 transition-colors ${
                    isVoiceActive ? 'bg-white/20' : 'bg-white/10'
                  }`}
                >
                  {isVoiceActive ? (
                    <Volume2 className="h-8 w-8" />
                  ) : (
                    <VolumeX className="h-8 w-8" />
                  )}
                </div>
                <div>
                  <h3 className="text-xl font-bold">Voice Agent</h3>
                  <p
                    className={`text-sm ${
                      isVoiceActive ? 'text-indigo-200' : 'text-gray-300'
                    }`}
                  >
                    {isVoiceActive
                      ? 'Active & Responding'
                      : 'Currently Disabled'}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleVoiceAgent}
                disabled={saving}
                className={`relative inline-flex h-12 w-24 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-white/50 ${
                  isVoiceActive
                    ? 'bg-green-400 shadow-lg shadow-green-400/30'
                    : 'bg-gray-500'
                }`}
                aria-label={`Voice agent is ${
                  isVoiceActive ? 'enabled' : 'disabled'
                }. Click to ${isVoiceActive ? 'disable' : 'enable'}.`}
              >
                <span
                  className={`inline-block h-10 w-10 transform rounded-full bg-white shadow-md transition-all duration-300 ${
                    isVoiceActive ? 'translate-x-12' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <div className="flex items-center gap-1.5">
                <Zap className="h-4 w-4" />
                <span>Provider:</span>
                <strong className="capitalize">
                  {(activeVoiceProvider || '').replace('-', ' ')}
                </strong>
              </div>
              <div className="flex items-center gap-1.5">
                <Mic className="h-4 w-4" />
                <span>Mode:</span>
                <strong className="capitalize">
                  {(voiceMode || '').replace(/-/g, ' ')}
                </strong>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center hover:shadow-md transition-shadow">
            <div className="p-3 rounded-full bg-blue-100 mr-4 flex-shrink-0">
              <Mic className="h-6 w-6 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-500">Voice Notes</p>
              <p className="text-2xl font-bold text-gray-900">
                {analytics.voiceMessages || analytics.totalMessages || 0}
              </p>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center hover:shadow-md transition-shadow">
            <div className="p-3 rounded-full bg-red-100 mr-4 flex-shrink-0">
              <Phone className="h-6 w-6 text-red-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-500">
                Calls Rejected
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {analytics.totalCallsRejected || 0}
              </p>
            </div>
          </div>
        </div>

        {/* Secondary Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center hover:shadow-md hover:border-gray-200 transition-all">
            <div className="p-2 rounded-full bg-green-100 mr-3">
              <Users className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Total Users</p>
              <p className="text-lg font-bold text-gray-900">
                {analytics.totalUsers || 0}
              </p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center hover:shadow-md hover:border-gray-200 transition-all">
            <div className="p-2 rounded-full bg-purple-100 mr-3">
              <Bot className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">AI Model</p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {activeAIProvider}
              </p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center hover:shadow-md hover:border-gray-200 transition-all">
            <div className="p-2 rounded-full bg-indigo-100 mr-3">
              <Database className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Datasets</p>
              <p className="text-lg font-bold text-gray-900">
                {datasets.length}
              </p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center hover:shadow-md hover:border-gray-200 transition-all">
            <div
              className={`p-2 rounded-full mr-3 ${
                isVoiceActive ? 'bg-green-100' : 'bg-gray-100'
              }`}
            >
              {isVoiceActive ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-gray-400" />
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Status</p>
              <p
                className={`text-sm font-bold ${
                  isVoiceActive ? 'text-green-600' : 'text-gray-500'
                }`}
              >
                {isVoiceActive ? 'Online' : 'Offline'}
              </p>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left Column - Voice Providers Configuration */}
          <div className="xl:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <Settings className="h-5 w-5 mr-2 text-indigo-600" />
                Voice Synthesis Providers
              </h2>
              {activeVoiceProvider !== 'google-free' &&
                !providerHasApiKey(activeVoiceProvider) && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    API Key Required
                  </span>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4">
              {/* Provider Cards */}
              {(
                [
                  'google-free',
                  'google-cloud',
                  'gemini-tts',
                  'openai',
                  'elevenlabs',
                ] as const
              ).map((provider) => {
                const info = PROVIDER_INFO[provider];
                const config = getProviderConfig(provider);
                const isActiveProvider = activeVoiceProvider === provider;
                const isEditing = editingProvider === provider;
                // API keys are redacted by the server (GET returns
                // hasApiKey/hasGoogleApiKey booleans, not the raw key); fall
                // back to the legacy raw field for older responses.
                const hasApiKey = config.hasApiKey ?? !!config.apiKey;
                const hasGoogleApiKey =
                  config.hasGoogleApiKey ?? !!config.googleApiKey;

                return (
                  <div
                    key={provider}
                    className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden transition-all duration-300 ${
                      isActiveProvider
                        ? `${info.borderColor} shadow-lg`
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {/* Provider Header */}
                    <div
                      className={`p-4 border-b border-gray-100 ${info.bgColor}`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-gray-800">
                            {info.name}
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {info.description}
                          </p>
                        </div>
                        {isActiveProvider && (
                          <span
                            className={`${info.bgColor} ${info.textColor} text-xs font-bold px-2 py-1 rounded-full border ${info.borderColor}`}
                          >
                            Active
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Provider Content */}
                    {isEditing ? (
                      <div className="p-4 space-y-3">
                        {/* Info note */}
                        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-2.5 leading-relaxed">
                          {info.note}
                        </p>

                        {/* Response Mode */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">
                            Response Mode
                          </label>
                          <select
                            value={editFormData.mode || 'voice-and-text'}
                            onChange={(e) =>
                              setEditFormData({
                                ...editFormData,
                                mode: e.target.value as VoiceConfigData['mode'],
                              })
                            }
                            className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="voice-and-text">
                              Voice & Text (Recommended)
                            </option>
                            <option value="voice-only">Voice Only</option>
                            <option value="text-only">Text Only</option>
                          </select>
                        </div>

                        {/* Google Cloud API Key */}
                        {info.requiresGoogleApiKey && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">
                              Google Cloud API Key{' '}
                              <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="password"
                              value={editFormData.googleApiKey || ''}
                              onChange={(e) =>
                                setEditFormData({
                                  ...editFormData,
                                  googleApiKey: e.target.value,
                                })
                              }
                              placeholder="AIza..."
                              className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                              Enable "Cloud Text-to-Speech API" in Google Cloud
                              Console → APIs & Services
                            </p>
                          </div>
                        )}

                        {/* OpenAI / ElevenLabs API Key */}
                        {info.requiresApiKey && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">
                              API Key <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="password"
                              value={editFormData.apiKey || ''}
                              onChange={(e) =>
                                setEditFormData({
                                  ...editFormData,
                                  apiKey: e.target.value,
                                })
                              }
                              placeholder={
                                provider === 'openai'
                                  ? 'sk-...'
                                  : 'ElevenLabs API key'
                              }
                              className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                        )}

                        {/* Voice Selection — Google Cloud, Gemini TTS & OpenAI */}
                        {(provider === 'google-cloud' ||
                          provider === 'gemini-tts' ||
                          provider === 'openai') &&
                          info.voices.length > 0 && (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                Voice{' '}
                                {provider === 'google-cloud'
                                  ? '(EN & Tamil — Sinhala auto-routes to Google Free)'
                                  : provider === 'gemini-tts'
                                    ? '(Sinhala: use Sulafat — Warm)'
                                    : ''}
                              </label>
                              <select
                                value={
                                  editFormData.voiceId || info.voices[0]?.id
                                }
                                onChange={(e) =>
                                  setEditFormData({
                                    ...editFormData,
                                    voiceId: e.target.value,
                                  })
                                }
                                className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                              >
                                {info.voices.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                        {/* ElevenLabs: Voice ID + Model */}
                        {provider === 'elevenlabs' && (
                          <>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                Voice ID
                              </label>
                              <input
                                value={editFormData.voiceId || ''}
                                onChange={(e) =>
                                  setEditFormData({
                                    ...editFormData,
                                    voiceId: e.target.value,
                                  })
                                }
                                placeholder="e.g. pNInz6obpgDQGcFmaJcg"
                                className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                Model
                              </label>
                              <select
                                value={
                                  editFormData.ttsModel ||
                                  'eleven_multilingual_v2'
                                }
                                onChange={(e) =>
                                  setEditFormData({
                                    ...editFormData,
                                    ttsModel: e.target.value,
                                  })
                                }
                                className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="eleven_multilingual_v2">
                                  Multilingual v2 (Best)
                                </option>
                                <option value="eleven_turbo_v2">
                                  Turbo v2 (Faster)
                                </option>
                                <option value="eleven_monolingual_v1">
                                  Monolingual v1
                                </option>
                              </select>
                            </div>
                          </>
                        )}

                        {/* OpenAI quality model */}
                        {provider === 'openai' && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">
                              Quality
                            </label>
                            <select
                              value={editFormData.ttsModel || 'tts-1'}
                              onChange={(e) =>
                                setEditFormData({
                                  ...editFormData,
                                  ttsModel: e.target.value,
                                })
                              }
                              className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="tts-1">Standard (Faster)</option>
                              <option value="tts-1-hd">
                                HD (Higher Quality)
                              </option>
                            </select>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={() => setEditingProvider(null)}
                            className="flex-1 py-2.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveProviderConfig(provider)}
                            disabled={saving}
                            className={`flex-1 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${info.buttonColor}`}
                          >
                            {saving ? 'Saving...' : 'Activate & Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4">
                        {/* Config Summary */}
                        <div className="space-y-2 mb-4">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Mode:</span>
                            <span className="font-medium text-gray-800 capitalize">
                              {(config.mode || '').replace(/-/g, ' ')}
                            </span>
                          </div>
                          {info.requiresGoogleApiKey && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">GCloud Key:</span>
                              <span
                                className={`font-medium flex items-center gap-1 ${
                                  hasGoogleApiKey
                                    ? 'text-green-600'
                                    : 'text-amber-600'
                                }`}
                              >
                                {hasGoogleApiKey ? (
                                  <>
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Set
                                  </>
                                ) : (
                                  <>
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    Required
                                  </>
                                )}
                              </span>
                            </div>
                          )}
                          {info.requiresApiKey && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">API Key:</span>
                              <span
                                className={`font-medium flex items-center gap-1 ${
                                  hasApiKey
                                    ? 'text-green-600'
                                    : 'text-amber-600'
                                }`}
                              >
                                {hasApiKey ? (
                                  <>
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Configured
                                  </>
                                ) : (
                                  <>
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    Required
                                  </>
                                )}
                              </span>
                            </div>
                          )}
                          {config.voiceId && provider === 'openai' && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Voice:</span>
                              <span className="font-medium text-gray-800">
                                {getVoiceName(provider, config.voiceId)}
                              </span>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => startEditing(provider)}
                          className={`w-full py-2.5 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
                            isActiveProvider
                              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              : 'border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <Settings className="h-4 w-4" />
                          {isActiveProvider ? 'Modify' : 'Configure'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pipeline Visualization */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-800 flex items-center">
                  <Activity className="h-5 w-5 mr-2 text-indigo-500" />
                  Active Agent Pipeline
                </h3>
              </div>
              <div className="p-6 overflow-x-auto">
                <div className="flex items-center justify-center gap-2 sm:gap-4 min-w-max">
                  {/* User Voice Note */}
                  <div className="flex flex-col items-center min-w-[80px]">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-blue-100 flex items-center justify-center border-4 border-white shadow-md">
                      <MessageCircle className="h-7 w-7 sm:h-8 sm:w-8 text-blue-600" />
                    </div>
                    <span className="mt-2 text-xs sm:text-sm font-medium text-gray-700 text-center">
                      User Voice
                    </span>
                  </div>

                  <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8 text-gray-300 flex-shrink-0" />

                  {/* AI Brain */}
                  <Link
                    to="/config"
                    className="flex flex-col items-center group cursor-pointer min-w-[80px]"
                  >
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-purple-100 flex items-center justify-center border-4 border-white shadow-md group-hover:ring-2 ring-purple-400 transition-all">
                      <Bot className="h-7 w-7 sm:h-8 sm:w-8 text-purple-600" />
                    </div>
                    <span className="mt-2 text-xs sm:text-sm font-medium text-gray-700 group-hover:text-purple-600 text-center">
                      AI Brain
                    </span>
                    <span className="text-[10px] sm:text-xs text-gray-400">
                      {activeAIProvider}
                    </span>
                  </Link>

                  <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8 text-gray-300 flex-shrink-0" />

                  {/* TTS */}
                  <div className="flex flex-col items-center min-w-[80px]">
                    <div
                      className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center border-4 border-white shadow-md ring-2 transition-all ${
                        isVoiceActive
                          ? `${activeProviderInfo?.ringColor || 'ring-green-400'} ${
                              activeProviderInfo?.bgColor || 'bg-green-100'
                            }`
                          : 'ring-gray-300 bg-gray-100'
                      }`}
                    >
                      <AudioLines
                        className={`h-7 w-7 sm:h-8 sm:w-8 ${
                          isVoiceActive
                            ? activeProviderInfo?.textColor || 'text-green-600'
                            : 'text-gray-400'
                        }`}
                      />
                    </div>
                    <span
                      className={`mt-2 text-xs sm:text-sm font-medium text-center ${
                        isVoiceActive ? 'text-gray-700' : 'text-gray-400'
                      }`}
                    >
                      TTS
                    </span>
                    <span
                      className={`text-[10px] sm:text-xs capitalize ${
                        isVoiceActive
                          ? activeProviderInfo?.textColor
                          : 'text-gray-400'
                      }`}
                    >
                      {(activeVoiceProvider || '').replace('-', ' ')}
                    </span>
                  </div>

                  <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8 text-gray-300 flex-shrink-0" />

                  {/* Voice Reply */}
                  <div className="flex flex-col items-center min-w-[80px]">
                    <div
                      className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center border-4 border-white shadow-md ${
                        isVoiceActive ? 'bg-green-100' : 'bg-gray-100'
                      }`}
                    >
                      <Volume2
                        className={`h-7 w-7 sm:h-8 sm:w-8 ${
                          isVoiceActive ? 'text-green-600' : 'text-gray-400'
                        }`}
                      />
                    </div>
                    <span
                      className={`mt-2 text-xs sm:text-sm font-medium text-center ${
                        isVoiceActive ? 'text-gray-700' : 'text-gray-400'
                      }`}
                    >
                      Voice Reply
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Telephony Providers Section — live readiness + outbound test */}
            <TelephonyProvidersSection />

            {/* Live Call Answering — mode, TTS model, Business Calling API creds */}
            <LiveCallSettingsSection />

            {/* Call Agent Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-orange-50 to-red-50 px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <Phone className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-gray-800">
                        Voice Call Agent
                      </h3>
                      <p className="text-xs text-gray-500">
                        Auto-respond to incoming WhatsApp calls
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-medium px-3 py-1 rounded-full border ${
                        callAgentEnabled
                          ? 'bg-green-100 text-green-700 border-green-300'
                          : 'bg-gray-100 text-gray-500 border-gray-300'
                      }`}
                    >
                      {callAgentEnabled ? '● Active' : '○ Inactive'}
                    </span>
                    <button
                      onClick={toggleCallAgent}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        callAgentEnabled ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          callAgentEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {/* Gemini TTS info banner */}
                <div className="mb-4 flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
                  <Headphones className="h-4 w-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-indigo-800">
                    <span className="font-semibold">
                      Gemini TTS voice replies are active.
                    </span>{' '}
                    When a call comes in it is auto-rejected, then a{' '}
                    <span className="font-semibold">voice note</span> is
                    generated by{' '}
                    <span className="font-semibold">
                      gemini-2.5-flash-preview-tts
                    </span>{' '}
                    and sent instantly. Click the{' '}
                    <Headphones className="inline h-3 w-3" /> buttons below to
                    hear exactly what callers will receive.
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Configuration */}
                  <div className="md:col-span-2 space-y-4">
                    {/* Language test buttons */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Response Language & Test Voice
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { id: 'en', label: '🇬🇧 English', color: 'blue' },
                          { id: 'si', label: '🇱🇰 Sinhala', color: 'green' },
                          { id: 'ta', label: '🇮🇳 Tamil', color: 'orange' },
                        ].map((lang) => (
                          <div
                            key={lang.id}
                            className="flex items-center gap-1"
                          >
                            <button
                              onClick={() =>
                                setCallAgentLanguage(
                                  lang.id as 'en' | 'si' | 'ta',
                                )
                              }
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                                callAgentLanguage === lang.id
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-300'
                              }`}
                            >
                              {lang.label}
                            </button>
                            <button
                              onClick={() =>
                                testLanguageGreeting(
                                  lang.id as 'en' | 'si' | 'ta',
                                )
                              }
                              disabled={testingVoiceLang === lang.id}
                              title="Play Gemini TTS voice reply"
                              className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
                            >
                              {testingVoiceLang === lang.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Headphones className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                      {testVoiceError && (
                        <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> {testVoiceError}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1.5">
                        Click <Headphones className="inline h-3 w-3" /> to
                        preview the actual Gemini TTS voice that callers will
                        hear. Select primary language for AI-generated
                        responses.
                      </p>
                    </div>

                    {/* AI Personality */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        AI Personality{' '}
                        <span className="text-gray-400 font-normal">
                          (optional — enables dynamic AI responses)
                        </span>
                      </label>
                      <textarea
                        value={callAgentPersonality}
                        onChange={(e) =>
                          setCallAgentPersonality(e.target.value)
                        }
                        placeholder="e.g. You are a friendly receptionist for Jayalath Global. Speak warmly and professionally. Always offer to schedule a callback..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
                        rows={3}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        When set, the AI generates a unique greeting for each
                        call based on this personality.
                      </p>
                    </div>

                    {/* Custom greeting */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Static Call Response Message{' '}
                        <span className="text-gray-400 font-normal">
                          (used when AI Personality is empty)
                        </span>
                      </label>
                      <textarea
                        value={callAgentGreeting}
                        onChange={(e) => setCallAgentGreeting(e.target.value)}
                        placeholder="Leave empty to use the default trilingual message (EN/SI/TA)..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
                        rows={3}
                      />
                    </div>

                    <button
                      onClick={saveCallAgentSettings}
                      disabled={savingCallAgent}
                      className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {savingCallAgent
                        ? 'Saving...'
                        : 'Save Call Agent Settings'}
                    </button>
                  </div>

                  {/* Stats */}
                  <div className="space-y-3">
                    <div className="bg-orange-50 rounded-xl p-4 text-center border border-orange-100">
                      <p className="text-3xl font-bold text-orange-600">
                        {analytics.totalCallsRejected || 0}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Calls Handled
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <p className="text-xs font-medium text-gray-600 mb-2">
                        How it works:
                      </p>
                      <ol className="space-y-1.5 text-xs text-gray-500">
                        <li className="flex gap-2">
                          <span className="text-orange-500 font-bold">1.</span>{' '}
                          Call comes in → Auto-rejected
                        </li>
                        <li className="flex gap-2">
                          <span className="text-orange-500 font-bold">2.</span>{' '}
                          Gemini AI generates greeting text
                        </li>
                        <li className="flex gap-2">
                          <span className="text-orange-500 font-bold">3.</span>{' '}
                          Gemini TTS converts text → voice note 🎤
                        </li>
                        <li className="flex gap-2">
                          <span className="text-orange-500 font-bold">4.</span>{' '}
                          Voice note sent to caller instantly
                        </li>
                        <li className="flex gap-2">
                          <span className="text-orange-500 font-bold">5.</span>{' '}
                          Call logged · Caller added to CRM
                        </li>
                      </ol>
                      <div className="mt-3 pt-2 border-t border-gray-200">
                        <p className="text-xs text-indigo-600 font-medium">
                          🎙 Powered by gemini-2.5-flash-preview-tts
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recent call logs */}
                {callLogs.length > 0 && (
                  <div className="mt-5 border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-gray-400" />
                      Recent Call Logs
                    </h4>
                    <div className="space-y-2">
                      {callLogs.slice(0, 5).map((log, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5 text-gray-400" />
                            <span className="font-mono text-gray-700">
                              {log.callerId?.replace('@s.whatsapp.net', '') ||
                                'Unknown'}
                            </span>
                            {log.language && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                {log.language.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                log.status === 'handled'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {log.status}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(log.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Branch Voice Consultant (Kiosk) — live preview of the public terminal */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-teal-50 to-cyan-50 px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-teal-100 rounded-lg">
                      <Mic className="h-5 w-5 text-teal-600" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-gray-800">
                        Branch Voice Consultant (Kiosk)
                      </h3>
                      <p className="text-xs text-gray-500">
                        Live preview of the public, push-to-talk terminal branch
                        visitors use
                      </p>
                    </div>
                  </div>
                  <a
                    href="/kiosk"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
                  >
                    <Play className="h-4 w-4" />
                    Open kiosk in new tab
                  </a>
                </div>
              </div>

              <div className="p-6">
                <div className="mb-4 flex items-start gap-3 bg-teal-50 border border-teal-200 rounded-lg px-4 py-3">
                  <Info className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-teal-800">
                    <span className="font-semibold">To test:</span> issue a code
                    from a CRM contact (the{' '}
                    <span className="font-semibold">Issue Pasyala code</span>{' '}
                    action), then type that 4-digit code into the kiosk below.
                    This embeds <span className="font-mono">/kiosk</span>{' '}
                    exactly as branch visitors see it. Microphone capture needs
                    HTTPS or localhost; the text box always works.
                  </div>
                </div>

                <div className="rounded-xl border-2 border-gray-200 overflow-hidden bg-gray-50 shadow-inner">
                  <iframe
                    src="/kiosk?preview=1"
                    title="Branch Voice Consultant Kiosk preview"
                    className="w-full h-[640px] border-0"
                    allow="microphone"
                  />
                </div>
              </div>
            </div>

            {/* Other Components Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* AI & Brain Configuration */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 relative overflow-hidden group hover:shadow-md transition-shadow">
                <div className="absolute top-4 right-4">
                  {globalConfig ? (
                    <span className="flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="h-4 w-4" />
                      Active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 text-sm">
                      <AlertCircle className="h-4 w-4" />
                      Setup Required
                    </span>
                  )}
                </div>
                <div className="flex items-center mb-4">
                  <div className="p-2 bg-purple-50 rounded-lg mr-3">
                    <Bot className="h-6 w-6 text-purple-600" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-800">
                    LLM Engine
                  </h3>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center bg-gray-50 px-4 py-3 rounded-lg">
                    <span className="text-sm text-gray-500">Model</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {activeAIProvider}
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <Link
                    to="/config"
                    className="text-sm text-purple-600 font-medium hover:text-purple-800 flex items-center group-hover:underline"
                  >
                    Configure AI Model <ChevronRight className="h-4 w-4 ml-1" />
                  </Link>
                </div>
              </div>

              {/* Datasets / Knowledge */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 relative overflow-hidden group hover:shadow-md transition-shadow">
                <div className="absolute top-4 right-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {datasets.length} Active
                  </span>
                </div>
                <div className="flex items-center mb-4">
                  <div className="p-2 bg-blue-50 rounded-lg mr-3">
                    <Database className="h-6 w-6 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-800">
                    Knowledge Base
                  </h3>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                  Connect datasets and PDFs to give your AI specific company
                  knowledge.
                </p>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <Link
                    to="/datasets"
                    className="text-sm text-blue-600 font-medium hover:text-blue-800 flex items-center group-hover:underline"
                  >
                    Manage Datasets <ChevronRight className="h-4 w-4 ml-1" />
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Activity & Info */}
          <div className="space-y-6">
            {/* Recent Leads Widget */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center">
                  <Users className="h-5 w-5 mr-2 text-green-600" />
                  <h3 className="font-semibold text-gray-800">Latest Leads</h3>
                </div>
                <Link
                  to="/crm"
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  View All
                </Link>
              </div>
              <div className="divide-y divide-gray-100">
                {recentLeads.length > 0 ? (
                  recentLeads.slice(0, 5).map((lead) => (
                    <div
                      key={lead._id}
                      className="p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">
                            {lead.fullName || 'Unknown'}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {formatPhone(lead.phoneNumber)}
                          </p>
                          <p className="text-xs text-gray-400 mt-1 truncate">
                            {lead.jobVacancyType || 'General Inquiry'}
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium flex-shrink-0 ${
                            lead.status === 'New'
                              ? 'bg-green-100 text-green-800'
                              : lead.status === 'Contacted'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {lead.status || 'New'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Users className="h-6 w-6 text-gray-300" />
                    </div>
                    <p className="text-gray-500 text-sm">No leads yet</p>
                    <p className="text-gray-400 text-xs mt-1">
                      Leads will appear here when users register
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* How it works info card */}
            <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 rounded-xl shadow-md p-6 text-white relative overflow-hidden">
              <div className="absolute -right-6 -top-6 opacity-10">
                <Bot className="h-40 w-40" />
              </div>
              <div className="relative">
                <h3 className="text-lg font-bold mb-3 flex items-center">
                  <Play className="h-5 w-5 mr-2 text-indigo-200" />
                  How Voice Agent Works
                </h3>
                <p className="text-indigo-100 text-sm leading-relaxed mb-4">
                  WhatsApp cloud servers cannot answer live voice calls.
                </p>
                <p className="text-indigo-100 text-sm leading-relaxed mb-4">
                  Your agent{' '}
                  <strong className="text-white">auto-rejects</strong> incoming
                  calls and asks users to send a Voice Note instead.
                </p>
                <div className="space-y-2.5">
                  {[
                    'Transcribes voice using AI',
                    'Generates intelligent response',
                    'Replies with voice note!',
                  ].map((step, idx) => (
                    <div
                      key={idx}
                      className="flex items-center text-indigo-100 text-sm"
                    >
                      <span className="bg-white/20 rounded-full w-5 h-5 flex items-center justify-center mr-2.5 text-xs font-bold flex-shrink-0">
                        {idx + 1}
                      </span>
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center">
                <Zap className="h-5 w-5 mr-2 text-amber-500" />
                Quick Actions
              </h3>
              <div className="space-y-2">
                {/* FIX H8: /chats → /chat (correct route) */}
                <Link
                  to="/chat"
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                >
                  <span className="text-sm font-medium text-gray-700">
                    Open Live Chat
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                </Link>
                {/* FIX M8: /analytics redirects to /crm — link directly to /crm */}
                <Link
                  to="/crm"
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                >
                  <span className="text-sm font-medium text-gray-700">
                    View CRM & Analytics
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                </Link>
                <Link
                  to="/config"
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                >
                  <span className="text-sm font-medium text-gray-700">
                    AI Settings
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
