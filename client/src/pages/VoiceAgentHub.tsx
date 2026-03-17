import { useState, useEffect } from 'react';
import { api } from '../config';
import { Link } from 'react-router-dom';
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
    Power,
    Mic,
    Volume2,
    VolumeX,
    RefreshCw,
    AlertCircle,
    X,
    Phone,
    Play,
    Info,
    Zap
} from 'lucide-react';

// Types
interface VoiceConfigData {
    _id?: string;
    provider: 'google-free' | 'openai' | 'elevenlabs';
    apiKey?: string;
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
        name: 'Google TTS',
        description: 'Free, Standard Quality',
        color: 'green',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-500',
        textColor: 'text-green-600',
        buttonColor: 'bg-green-600 hover:bg-green-700',
        requiresApiKey: false,
        voices: [
            { id: 'en', name: 'English' },
            { id: 'si', name: 'Sinhala' }
        ]
    },
    'openai': {
        name: 'OpenAI Voice',
        description: 'High Quality, Natural',
        color: 'blue',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-500',
        textColor: 'text-blue-600',
        buttonColor: 'bg-blue-600 hover:bg-blue-700',
        requiresApiKey: true,
        voices: [
            { id: 'alloy', name: 'Alloy (Neutral)' },
            { id: 'echo', name: 'Echo (Male)' },
            { id: 'fable', name: 'Fable (British)' },
            { id: 'onyx', name: 'Onyx (Deep)' },
            { id: 'nova', name: 'Nova (Female)' },
            { id: 'shimmer', name: 'Shimmer (Warm)' }
        ]
    },
    'elevenlabs': {
        name: 'ElevenLabs',
        description: 'Premium, Voice Cloning',
        color: 'purple',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-500',
        textColor: 'text-purple-600',
        buttonColor: 'bg-purple-600 hover:bg-purple-700',
        requiresApiKey: true,
        voices: []
    }
};

export default function VoiceAgentHub() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);

    // States representing the different modules
    const [voiceConfigs, setVoiceConfigs] = useState<VoiceConfigData[]>([]);
    const [activeVoiceConfig, setActiveVoiceConfig] = useState<VoiceConfigData | null>(null);
    const [globalConfig, setGlobalConfig] = useState<AIProviderConfig | null>(null);
    const [datasets, setDatasets] = useState<DatasetItem[]>([]);
    const [analytics, setAnalytics] = useState<AnalyticsData>({ totalVoiceNotes: 0, totalCallsRejected: 0 });
    const [recentLeads, setRecentLeads] = useState<LeadItem[]>([]);

    // Edit mode for voice provider
    const [editingProvider, setEditingProvider] = useState<string | null>(null);
    const [editFormData, setEditFormData] = useState<Partial<VoiceConfigData>>({});
    const [showConfirmToggle, setShowConfirmToggle] = useState(false);
    const [pendingToggleState, setPendingToggleState] = useState<boolean | null>(null);

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

    const fetchAllData = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            const [
                voiceRes,
                configRes,
                datasetRes,
                analyticsRes,
                leadsRes
            ] = await Promise.all([
                api.get('/api/voice-config').catch(() => ({ data: [] })),
                api.get('/api/config').catch(() => ({ data: [] })),
                api.get('/api/datasets').catch(() => ({ data: [] })),
                api.get('/api/analytics/overview').catch(() => ({ data: {} })),
                api.get('/api/leads?limit=5').catch(() => ({ data: { leads: [] } }))
            ]);

            const vData = Array.isArray(voiceRes.data) ? voiceRes.data : [voiceRes.data];
            setVoiceConfigs(vData);

            // Find the currently active config (where isActive is true)
            const activeConfig = vData.find((c: VoiceConfigData) => c.isActive === true);
            // If no active config, use the most recently updated one
            const sortedConfigs = [...vData].sort((a, b) =>
                new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
            );
            setActiveVoiceConfig(activeConfig || sortedConfigs[0] || null);

            // Handle config as array
            const configs = Array.isArray(configRes.data) ? configRes.data : [];
            const activeAI = configs.find((c: AIProviderConfig) => c.isActive && c.isProvider);
            setGlobalConfig(activeAI || null);

            setDatasets(Array.isArray(datasetRes.data) ? datasetRes.data : []);
            setAnalytics(analyticsRes.data || { totalVoiceNotes: 0, totalCallsRejected: 0 });
            setRecentLeads(leadsRes.data?.leads || []);

        } catch (error) {
            console.error("Failed to load Hub data", error);
            setMessage({ type: 'error', text: 'Failed to load data. Please try again.' });
        } finally {
            setLoading(false);
            setRefreshing(false);
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
            setActiveVoiceConfig(prev => prev ? { ...prev, isActive: newIsActive } : null);
            setVoiceConfigs(prev => prev.map(c => ({ ...c, isActive: newIsActive })));

            setMessage({
                type: 'success',
                text: `Voice Agent ${newIsActive ? 'enabled' : 'disabled'} successfully`
            });
        } catch {
            setMessage({ type: 'error', text: 'Failed to update voice agent status' });
        } finally {
            setSaving(false);
        }
    };

    // Save voice provider configuration
    const saveProviderConfig = async (providerName: string) => {
        // Validate API key for paid providers
        const providerInfo = PROVIDER_INFO[providerName as keyof typeof PROVIDER_INFO];
        if (providerInfo.requiresApiKey && !editFormData.apiKey) {
            setMessage({ type: 'error', text: `API Key is required for ${providerInfo.name}` });
            return;
        }

        setSaving(true);
        setMessage(null);
        try {
            const configToSave: VoiceConfigData = {
                provider: providerName as VoiceConfigData['provider'],
                mode: editFormData.mode || 'voice-and-text',
                apiKey: editFormData.apiKey,
                voiceId: editFormData.voiceId,
                ttsModel: editFormData.ttsModel,
                isActive: true
            };

            await api.post('/api/voice-config', configToSave);

            // Refresh all data to get the updated state
            await fetchAllData();

            setEditingProvider(null);
            setMessage({ type: 'success', text: `${PROVIDER_INFO[providerName as keyof typeof PROVIDER_INFO].name} activated successfully!` });
        } catch {
            setMessage({ type: 'error', text: `Failed to save ${providerName} configuration` });
        } finally {
            setSaving(false);
        }
    };

    // Start editing a provider
    const startEditing = (provider: string) => {
        const existing = voiceConfigs.find(c => c.provider === provider);
        setEditFormData(existing || {
            provider: provider as VoiceConfigData['provider'],
            mode: 'voice-and-text',
            apiKey: '',
            voiceId: provider === 'elevenlabs' ? '' : 'alloy',
            ttsModel: provider === 'elevenlabs' ? 'eleven_multilingual_v2' : 'tts-1'
        });
        setEditingProvider(provider);
    };

    // Get provider config
    const getProviderConfig = (providerName: string): VoiceConfigData => {
        const found = voiceConfigs.find(c => c.provider === providerName);
        if (found) return found;
        return {
            provider: providerName as VoiceConfigData['provider'],
            mode: 'voice-and-text',
            apiKey: '',
            voiceId: providerName === 'elevenlabs' ? '' : 'alloy',
            ttsModel: providerName === 'elevenlabs' ? 'eleven_multilingual_v2' : 'tts-1',
            isActive: false
        };
    };

    // Get voice name by ID
    const getVoiceName = (provider: string, voiceId?: string): string => {
        if (!voiceId) return 'Not set';
        const providerInfo = PROVIDER_INFO[provider as keyof typeof PROVIDER_INFO];
        const voice = providerInfo?.voices.find(v => v.id === voiceId);
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
    const activeAIProvider = globalConfig?.aiModel || globalConfig?.providerType || 'Not Configured';
    const activeProviderInfo = PROVIDER_INFO[activeVoiceProvider as keyof typeof PROVIDER_INFO];

    return (
        <div className="max-w-7xl mx-auto pb-8">
            {/* Header */}
            <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center">
                        <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg mr-3">
                            <AudioLines className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
                        </div>
                        Voice Agent Hub
                    </h1>
                    <p className="text-gray-500 mt-2 ml-1">Central command for your WhatsApp Voice AI infrastructure</p>
                </div>
                <button
                    onClick={() => fetchAllData(true)}
                    disabled={refreshing}
                    className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Notification Toast */}
            {message && (
                <div className={`fixed top-4 right-4 z-50 mb-6 p-4 rounded-lg shadow-lg flex items-center gap-3 max-w-md animate-slide-in ${
                    message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
                    message.type === 'info' ? 'bg-blue-50 text-blue-800 border border-blue-200' :
                    'bg-red-50 text-red-800 border border-red-200'
                }`}>
                    {message.type === 'success' ? <CheckCircle2 className="h-5 w-5 flex-shrink-0" /> :
                     message.type === 'info' ? <Info className="h-5 w-5 flex-shrink-0" /> :
                     <AlertCircle className="h-5 w-5 flex-shrink-0" />}
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
                            <h3 className="text-lg font-bold text-gray-900">Disable Voice Agent?</h3>
                        </div>
                        <p className="text-gray-600 mb-6">
                            The voice agent will stop responding to voice notes and calls. Users will not receive voice replies.
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {/* Master Toggle Card */}
                <div className={`sm:col-span-2 p-6 rounded-xl shadow-lg text-white transition-all duration-300 ${
                    isVoiceActive
                        ? 'bg-gradient-to-br from-indigo-600 to-purple-700'
                        : 'bg-gradient-to-br from-gray-600 to-gray-700'
                }`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <div className={`p-3 rounded-lg mr-4 transition-colors ${
                                isVoiceActive ? 'bg-white/20' : 'bg-white/10'
                            }`}>
                                {isVoiceActive ? (
                                    <Volume2 className="h-8 w-8" />
                                ) : (
                                    <VolumeX className="h-8 w-8" />
                                )}
                            </div>
                            <div>
                                <h3 className="text-xl font-bold">Voice Agent</h3>
                                <p className={`text-sm ${isVoiceActive ? 'text-indigo-200' : 'text-gray-300'}`}>
                                    {isVoiceActive ? 'Active & Responding' : 'Currently Disabled'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={toggleVoiceAgent}
                            disabled={saving}
                            className={`relative inline-flex h-12 w-24 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-white/50 ${
                                isVoiceActive ? 'bg-green-400 shadow-lg shadow-green-400/30' : 'bg-gray-500'
                            }`}
                            aria-label={`Voice agent is ${isVoiceActive ? 'enabled' : 'disabled'}. Click to ${isVoiceActive ? 'disable' : 'enable'}.`}
                        >
                            <span className={`inline-block h-10 w-10 transform rounded-full bg-white shadow-md transition-all duration-300 ${
                                isVoiceActive ? 'translate-x-12' : 'translate-x-1'
                            }`} />
                        </button>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <div className="flex items-center gap-1.5">
                            <Zap className="h-4 w-4" />
                            <span>Provider:</span>
                            <strong className="capitalize">{activeVoiceProvider.replace('-', ' ')}</strong>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Mic className="h-4 w-4" />
                            <span>Mode:</span>
                            <strong className="capitalize">{voiceMode.replace(/-/g, ' ')}</strong>
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
                        <p className="text-2xl font-bold text-gray-900">{analytics.voiceMessages || analytics.totalMessages || 0}</p>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center hover:shadow-md transition-shadow">
                    <div className="p-3 rounded-full bg-red-100 mr-4 flex-shrink-0">
                        <Phone className="h-6 w-6 text-red-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-500">Calls Rejected</p>
                        <p className="text-2xl font-bold text-gray-900">{analytics.totalCallsRejected || 0}</p>
                    </div>
                </div>
            </div>

            {/* Secondary Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
                    <div className="p-2 rounded-full bg-green-100 mr-3">
                        <Users className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-gray-500">Total Users</p>
                        <p className="text-lg font-bold text-gray-900">{analytics.totalUsers || 0}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
                    <div className="p-2 rounded-full bg-purple-100 mr-3">
                        <Bot className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-gray-500">AI Model</p>
                        <p className="text-sm font-bold text-gray-900 truncate">{activeAIProvider}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
                    <div className="p-2 rounded-full bg-indigo-100 mr-3">
                        <Database className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-gray-500">Datasets</p>
                        <p className="text-lg font-bold text-gray-900">{datasets.length}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
                    <div className={`p-2 rounded-full mr-3 ${isVoiceActive ? 'bg-green-100' : 'bg-gray-100'}`}>
                        {isVoiceActive ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                            <XCircle className="h-5 w-5 text-gray-400" />
                        )}
                    </div>
                    <div>
                        <p className="text-xs font-medium text-gray-500">Status</p>
                        <p className={`text-sm font-bold ${isVoiceActive ? 'text-green-600' : 'text-gray-500'}`}>
                            {isVoiceActive ? 'Online' : 'Offline'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Left Column - Voice Providers Configuration */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-gray-800 flex items-center">
                            <Settings className="h-5 w-5 mr-2 text-indigo-600" />
                            Voice Synthesis Providers
                        </h2>
                        {activeVoiceProvider !== 'google-free' && !getProviderConfig(activeVoiceProvider).apiKey && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />
                                API Key Required
                            </span>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Provider Cards */}
                        {(['google-free', 'openai', 'elevenlabs'] as const).map((provider) => {
                            const info = PROVIDER_INFO[provider];
                            const config = getProviderConfig(provider);
                            const isActiveProvider = activeVoiceProvider === provider;
                            const isEditing = editingProvider === provider;
                            const hasApiKey = !!config.apiKey;

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
                                    <div className={`p-4 border-b border-gray-100 ${info.bgColor}`}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="font-bold text-gray-800">{info.name}</h3>
                                                <p className="text-xs text-gray-500 mt-0.5">{info.description}</p>
                                            </div>
                                            {isActiveProvider && (
                                                <span className={`${info.bgColor} ${info.textColor} text-xs font-bold px-2 py-1 rounded-full border ${info.borderColor}`}>
                                                    Active
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Provider Content */}
                                    {isEditing ? (
                                        <div className="p-4 space-y-3">
                                            {/* Response Mode */}
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 mb-1.5">Response Mode</label>
                                                <select
                                                    value={editFormData.mode || 'voice-and-text'}
                                                    onChange={(e) => setEditFormData({ ...editFormData, mode: e.target.value as VoiceConfigData['mode'] })}
                                                    className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                >
                                                    <option value="voice-and-text">Voice & Text</option>
                                                    <option value="voice-only">Voice Only</option>
                                                    <option value="text-only">Text Only</option>
                                                </select>
                                            </div>

                                            {/* API Key for paid providers */}
                                            {info.requiresApiKey && (
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                                        API Key <span className="text-red-500">*</span>
                                                    </label>
                                                    <input
                                                        type="password"
                                                        value={editFormData.apiKey || ''}
                                                        onChange={(e) => setEditFormData({ ...editFormData, apiKey: e.target.value })}
                                                        placeholder={`Enter ${info.name} API Key`}
                                                        className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                    />
                                                </div>
                                            )}

                                            {/* Voice Selection for OpenAI */}
                                            {provider === 'openai' && (
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Voice</label>
                                                    <select
                                                        value={editFormData.voiceId || 'alloy'}
                                                        onChange={(e) => setEditFormData({ ...editFormData, voiceId: e.target.value })}
                                                        className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                    >
                                                        {info.voices.map(voice => (
                                                            <option key={voice.id} value={voice.id}>{voice.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            {/* Voice ID for ElevenLabs */}
                                            {provider === 'elevenlabs' && (
                                                <>
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Voice ID</label>
                                                        <input
                                                            value={editFormData.voiceId || ''}
                                                            onChange={(e) => setEditFormData({ ...editFormData, voiceId: e.target.value })}
                                                            placeholder="e.g. pNInz6obpgDQGcFmaJcg"
                                                            className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Model</label>
                                                        <select
                                                            value={editFormData.ttsModel || 'eleven_multilingual_v2'}
                                                            onChange={(e) => setEditFormData({ ...editFormData, ttsModel: e.target.value })}
                                                            className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                        >
                                                            <option value="eleven_multilingual_v2">Multilingual v2</option>
                                                            <option value="eleven_turbo_v2">Turbo v2</option>
                                                            <option value="eleven_monolingual_v1">Monolingual v1</option>
                                                        </select>
                                                    </div>
                                                </>
                                            )}

                                            {/* Quality for OpenAI */}
                                            {provider === 'openai' && (
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Quality</label>
                                                    <select
                                                        value={editFormData.ttsModel || 'tts-1'}
                                                        onChange={(e) => setEditFormData({ ...editFormData, ttsModel: e.target.value })}
                                                        className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                    >
                                                        <option value="tts-1">Standard</option>
                                                        <option value="tts-1-hd">HD (Higher Quality)</option>
                                                    </select>
                                                </div>
                                            )}

                                            {/* Free tier note */}
                                            {!info.requiresApiKey && (
                                                <p className="text-xs text-gray-500 italic bg-gray-50 p-2 rounded">
                                                    No API key required - uses free Google TTS
                                                </p>
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
                                                    className={`flex-1 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${info.buttonColor}`}
                                                >
                                                    {saving ? 'Saving...' : 'Activate'}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-4">
                                            {/* Config Summary */}
                                            <div className="space-y-2 mb-4">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-gray-500">Mode:</span>
                                                    <span className="font-medium text-gray-800 capitalize">{config.mode.replace(/-/g, ' ')}</span>
                                                </div>
                                                {info.requiresApiKey && (
                                                    <div className="flex justify-between text-sm">
                                                        <span className="text-gray-500">API Key:</span>
                                                        <span className={`font-medium flex items-center gap-1 ${hasApiKey ? 'text-green-600' : 'text-amber-600'}`}>
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
                                                        <span className="font-medium text-gray-800">{getVoiceName(provider, config.voiceId)}</span>
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
                                    <span className="mt-2 text-xs sm:text-sm font-medium text-gray-700 text-center">User Voice</span>
                                </div>

                                <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8 text-gray-300 flex-shrink-0" />

                                {/* AI Brain */}
                                <Link to="/config" className="flex flex-col items-center group cursor-pointer min-w-[80px]">
                                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-purple-100 flex items-center justify-center border-4 border-white shadow-md group-hover:ring-2 ring-purple-400 transition-all">
                                        <Bot className="h-7 w-7 sm:h-8 sm:w-8 text-purple-600" />
                                    </div>
                                    <span className="mt-2 text-xs sm:text-sm font-medium text-gray-700 group-hover:text-purple-600 text-center">AI Brain</span>
                                    <span className="text-[10px] sm:text-xs text-gray-400">{activeAIProvider}</span>
                                </Link>

                                <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8 text-gray-300 flex-shrink-0" />

                                {/* TTS */}
                                <div className="flex flex-col items-center min-w-[80px]">
                                    <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center border-4 border-white shadow-md ring-2 transition-all ${
                                        isVoiceActive
                                            ? `ring-${activeProviderInfo?.color || 'green'}-400 ${activeProviderInfo?.bgColor || 'bg-green-100'}`
                                            : 'ring-gray-300 bg-gray-100'
                                    }`}>
                                        <AudioLines className={`h-7 w-7 sm:h-8 sm:w-8 ${isVoiceActive ? (activeProviderInfo?.textColor || 'text-green-600') : 'text-gray-400'}`} />
                                    </div>
                                    <span className={`mt-2 text-xs sm:text-sm font-medium text-center ${isVoiceActive ? 'text-gray-700' : 'text-gray-400'}`}>TTS</span>
                                    <span className={`text-[10px] sm:text-xs capitalize ${isVoiceActive ? activeProviderInfo?.textColor : 'text-gray-400'}`}>
                                        {activeVoiceProvider.replace('-', ' ')}
                                    </span>
                                </div>

                                <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8 text-gray-300 flex-shrink-0" />

                                {/* Voice Reply */}
                                <div className="flex flex-col items-center min-w-[80px]">
                                    <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center border-4 border-white shadow-md ${
                                        isVoiceActive ? 'bg-green-100' : 'bg-gray-100'
                                    }`}>
                                        <Volume2 className={`h-7 w-7 sm:h-8 sm:w-8 ${isVoiceActive ? 'text-green-600' : 'text-gray-400'}`} />
                                    </div>
                                    <span className={`mt-2 text-xs sm:text-sm font-medium text-center ${isVoiceActive ? 'text-gray-700' : 'text-gray-400'}`}>Voice Reply</span>
                                </div>
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
                                <h3 className="text-lg font-bold text-gray-800">LLM Engine</h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center bg-gray-50 px-4 py-3 rounded-lg">
                                    <span className="text-sm text-gray-500">Model</span>
                                    <span className="text-sm font-semibold text-gray-900">{activeAIProvider}</span>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <Link to="/config" className="text-sm text-purple-600 font-medium hover:text-purple-800 flex items-center group-hover:underline">
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
                                <h3 className="text-lg font-bold text-gray-800">Knowledge Base</h3>
                            </div>
                            <p className="text-sm text-gray-500 mb-4">
                                Connect datasets and PDFs to give your AI specific company knowledge.
                            </p>
                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <Link to="/datasets" className="text-sm text-blue-600 font-medium hover:text-blue-800 flex items-center group-hover:underline">
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
                        <div className="bg-gray-50 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                            <div className="flex items-center">
                                <Users className="h-5 w-5 mr-2 text-green-600" />
                                <h3 className="font-semibold text-gray-800">Latest Leads</h3>
                            </div>
                            <Link to="/crm" className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                                View All
                            </Link>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {recentLeads.length > 0 ? (
                                recentLeads.slice(0, 5).map((lead) => (
                                    <div key={lead._id} className="p-4 hover:bg-gray-50 transition-colors">
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
                                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium flex-shrink-0 ${
                                                lead.status === 'New' ? 'bg-green-100 text-green-800' :
                                                lead.status === 'Contacted' ? 'bg-blue-100 text-blue-800' :
                                                'bg-gray-100 text-gray-800'
                                            }`}>
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
                                    <p className="text-gray-400 text-xs mt-1">Leads will appear here when users register</p>
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
                                Your agent <strong className="text-white">auto-rejects</strong> incoming calls and asks users to send a Voice Note instead.
                            </p>
                            <div className="space-y-2.5">
                                {[
                                    'Transcribes voice using AI',
                                    'Generates intelligent response',
                                    'Replies with voice note!'
                                ].map((step, idx) => (
                                    <div key={idx} className="flex items-center text-indigo-100 text-sm">
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
                            <Link
                                to="/chats"
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                            >
                                <span className="text-sm font-medium text-gray-700">Open Live Chat</span>
                                <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                            </Link>
                            <Link
                                to="/analytics"
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                            >
                                <span className="text-sm font-medium text-gray-700">View Analytics</span>
                                <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                            </Link>
                            <Link
                                to="/config"
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                            >
                                <span className="text-sm font-medium text-gray-700">AI Settings</span>
                                <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}