import { useState, useEffect, useCallback } from 'react';
import { api } from '../config';
import { Plus, Trash, Edit, Save, X, Bot, Settings, Activity, Cpu, Mic, RefreshCw, Calendar, Clock, TrendingUp, AlertCircle, DollarSign, Zap } from 'lucide-react';

interface Config {
    _id: string;
    key: string;
    value: string;
    description?: string;
    isProvider?: boolean;
    providerType?: string;
    apiKey?: string;
    aiModel?: string;
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
    provider: 'google-free' | 'google-cloud' | 'openai' | 'elevenlabs';
    apiKey?: string;
    googleApiKey?: string;
    voiceId?: string;
    isActive?: boolean;
    mode: 'voice-only' | 'text-only' | 'voice-and-text';
    ttsModel?: 'tts-1' | 'tts-1-hd' | 'eleven_multilingual_v2' | 'eleven_monolingual_v1' | 'eleven_turbo_v2';
}

// Helper to extract error message from axios errors
const getErrorMessage = (err: unknown): string => {
    if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { message?: string; error?: string }; status?: number } };
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
    const [activeTab, setActiveTab] = useState<'general' | 'ai' | 'voice'>('ai');

    // Usage Cycle State
    const [usageCycle, setUsageCycle] = useState<UsageCycle | null>(null);
    const [resettingAll, setResettingAll] = useState(false);
    const [resettingId, setResettingId] = useState<string | null>(null);

    // Voice Config State
    const [voiceConfigs, setVoiceConfigs] = useState<VoiceConfigData[]>([]);
    const [activeVoiceProvider, setActiveVoiceProvider] = useState<string>('google-free');
    const [voiceLoading, setVoiceLoading] = useState(true);
    const [voiceSaving, setVoiceSaving] = useState(false);
    const [voiceMessage, setVoiceMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Default form data
    const [formData, setFormData] = useState<Partial<Config>>({
        key: '', value: '', description: '',
        isProvider: false, providerType: 'openai',
        apiKey: '', aiModel: '', isActive: false
    });

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
            const daysRemaining = Math.ceil((periodEnd.getTime() - now.getTime()) / 86400000);
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
        if (!confirm('Reset ALL provider token usage to 0 for this month? This cannot be undone.')) return;
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

                // Ensure LOCAL_NLP_ENABLED exists in DB
                const hasLocalNLP = res.data.find(c => c.key === 'LOCAL_NLP_ENABLED');
                if (!hasLocalNLP) {
                    await api.post('/api/config', {
                        key: 'LOCAL_NLP_ENABLED',
                        value: 'false',
                        description: 'Enables Auto-Learning Local NLP Caching to save API Tokens.',
                        isProvider: false
                    });
                    // Re-fetch after creating
                    const refetch = await api.get('/api/config');
                    setConfigs(refetch.data);
                }
            } else {
                console.error("Expected array but got:", res.data);
                setConfigs([]);
            }
        } catch (error) {
            console.error("Failed to fetch configs", error);
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
    };

    const handleCreate = () => {
        setFormData({
            key: '', value: '', description: '',
            isProvider: activeTab === 'ai', // Auto-set based on tab
            providerType: 'openai',
            isActive: false,
            usageLimit: 1000000,
            costPerToken: 0.000002
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

    const toggleLocalNLP = async () => {
        const nlpConfig = configs.find(c => c.key === 'LOCAL_NLP_ENABLED');
        if (nlpConfig) {
            const newValue = nlpConfig.value === 'true' ? 'false' : 'true';
            try {
                await api.put(`/api/config/${nlpConfig._id}`, { ...nlpConfig, value: newValue });
                fetchConfigs();
            } catch {
                alert('Error updating Local NLP config');
            }
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
                'openai': 'OpenAI TTS',
                'elevenlabs': 'ElevenLabs',
            };
            setVoiceMessage({ type: 'success', text: `✅ ${label[providerName] || providerName} activated! The system will auto-fallback to the next provider if this one is unavailable.` });
            fetchVoiceConfig();
        } catch (error) {
            console.error('Failed to save config', error);
            setVoiceMessage({ type: 'error', text: `Failed to save ${providerName} configuration.` });
        } finally {
            setVoiceSaving(false);
        }
    };

    const updateProviderConfig = (providerName: string, updates: Partial<VoiceConfigData>) => {
        setVoiceConfigs((prev) => {
            const exists = prev.find((c) => c.provider === providerName);
            if (exists) {
                return prev.map((c) => c.provider === providerName ? { ...c, ...updates } : c);
            } else {
                return [...prev, { provider: providerName as VoiceConfigData['provider'], mode: 'voice-and-text' as const, ...updates }];
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
            ttsModel: providerName === 'elevenlabs' ? 'eleven_multilingual_v2' : 'tts-1',
            voiceId: providerName === 'google-cloud' ? 'en-US-Neural2-F' : providerName === 'elevenlabs' ? '' : 'nova',
        };
    };



    const generalConfigs = configs.filter(c => !c.isProvider);
    const aiConfigs = configs.filter(c => c.isProvider);

    if (isEditing) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-md max-w-2xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-semibold">{editingId ? 'Edit Config' : 'New Config'}</h2>
                    <button onClick={() => setIsEditing(false)} className="text-gray-500 hover:text-gray-700">
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <div className="space-y-4">
                    {/* Toggle between General and AI (only for new items) */}
                    {!editingId && (
                        <div className="flex space-x-4 mb-4">
                            <button
                                onClick={() => setFormData({ ...formData, isProvider: false })}
                                className={`px-4 py-2 rounded-lg ${!formData.isProvider ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
                            >General Config</button>
                            <button
                                onClick={() => setFormData({ ...formData, isProvider: true })}
                                className={`px-4 py-2 rounded-lg ${formData.isProvider ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
                            >AI Provider</button>
                        </div>
                    )}

                    {formData.isProvider ? (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Provider</label>
                                <select
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                    value={formData.providerType}
                                    onChange={e => setFormData({ ...formData, providerType: e.target.value })}
                                >
                                    <option value="openai">OpenAI (GPT)</option>
                                    <option value="anthropic">Anthropic (Claude)</option>
                                    <option value="google">Google (Gemini)</option>
                                    <option value="groq">Groq</option>
                                    <option value="openrouter">OpenRouter (Multi-Provider)</option>
                                    <option value="local">Local (Ollama/LM Studio)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">API Key</label>
                                <input
                                    type="password"
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                    value={formData.apiKey || ''}
                                    onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                                    placeholder="sk-..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Model Name</label>
                                <input
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                    value={formData.aiModel || ''}
                                    onChange={e => setFormData({ ...formData, aiModel: e.target.value })}
                                    placeholder={
                                        formData.providerType === 'openrouter'
                                            ? 'e.g. openai/gpt-4o, anthropic/claude-3-opus'
                                            : 'e.g. gpt-4-turbo'
                                    }
                                />
                                {formData.providerType === 'openrouter' && (
                                    <p className="mt-1 text-xs text-gray-500">
                                        Format: provider/model-name.
                                        <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">
                                            Browse models →
                                        </a>
                                    </p>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Cost per Token ($)</label>
                                    <input
                                        type="number"
                                        step="0.0000001"
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                        value={formData.costPerToken || 0}
                                        onChange={e => setFormData({ ...formData, costPerToken: parseFloat(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Monthly Token Limit</label>
                                    <input
                                        type="number"
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                        value={formData.usageLimit || 0}
                                        onChange={e => setFormData({ ...formData, usageLimit: parseInt(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Monthly Budget ($) <span className="text-gray-400 font-normal">(optional cost cap)</span></label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                    value={formData.monthlyBudget || 0}
                                    placeholder="e.g. 10.00"
                                    onChange={e => setFormData({ ...formData, monthlyBudget: parseFloat(e.target.value) })}
                                />
                                <p className="text-xs text-gray-500 mt-1">Shows a warning badge on the card when estimated cost exceeds this amount.</p>
                            </div>
                            <div className="flex items-center pt-2">
                                <input
                                    type="checkbox"
                                    id="isActive"
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                    checked={formData.isActive || false}
                                    onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                />
                                <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
                                    Set as Active Provider
                                </label>
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Key</label>
                                <input
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                    value={formData.key}
                                    disabled={!!editingId}
                                    onChange={e => setFormData({ ...formData, key: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Value</label>
                                <input
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                    value={formData.value}
                                    onChange={e => setFormData({ ...formData, value: e.target.value })}
                                />
                            </div>
                        </>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Description</label>
                        <textarea
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                            value={formData.description || ''}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    <div className="flex justify-end pt-4">
                        <button onClick={() => setIsEditing(false)} className="mr-3 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Cancel</button>
                        <button onClick={handleSave} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
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

            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-6">
                <button
                    className={`py-2 px-4 font-medium text-sm ${activeTab === 'ai' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    onClick={() => setActiveTab('ai')}
                >
                    <div className="flex items-center">
                        <Bot className="w-4 h-4 mr-2" /> AI Providers
                    </div>
                </button>
                <button
                    className={`py-2 px-4 font-medium text-sm ${activeTab === 'general' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    onClick={() => setActiveTab('general')}
                >
                    <div className="flex items-center">
                        <Settings className="w-4 h-4 mr-2" /> General Settings
                    </div>
                </button>
                <button
                    className={`py-2 px-4 font-medium text-sm ${activeTab === 'voice' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
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
                                        <p className="text-sm text-indigo-200 font-medium uppercase tracking-wider">Current Billing Period</p>
                                        <p className="text-xl font-bold mt-0.5">
                                            {new Date(usageCycle.periodStart).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                                            {' '}&ndash;{' '}
                                            {new Date(usageCycle.periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                                        </p>
                                        <div className="flex items-center gap-4 mt-2 text-sm">
                                            <span className="flex items-center gap-1 text-indigo-200">
                                                <Clock className="h-3.5 w-3.5" />
                                                {usageCycle.daysElapsed} of {usageCycle.totalDays} days used
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
                                        <p className="text-xs text-indigo-200 uppercase tracking-wider">Next Auto-Reset</p>
                                        <p className="font-bold text-lg">
                                            {new Date(usageCycle.nextReset).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </p>
                                        <p className="text-xs text-indigo-200">at 00:00 AM (midnight)</p>
                                    </div>
                                    <button
                                        onClick={handleResetAll}
                                        disabled={resettingAll}
                                        className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 border border-white/30 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                                    >
                                        <RefreshCw className={`h-4 w-4 ${resettingAll ? 'animate-spin' : ''}`} />
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
                                        <span className="text-indigo-200">Total Tokens This Month:</span>
                                        <span className="font-bold">
                                            {aiConfigs.reduce((s, c) => s + (c.usageUsed || 0), 0).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <DollarSign className="h-4 w-4 text-indigo-200" />
                                        <span className="text-indigo-200">Total Est. Cost:</span>
                                        <span className="font-bold">
                                            ${aiConfigs.reduce((s, c) => s + (c.usageUsed || 0) * (c.costPerToken || 0), 0).toFixed(4)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── AI Provider Cards ────────────────────────────────── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {aiConfigs.map(c => {
                            const used = c.usageUsed || 0;
                            const limit = c.usageLimit || 0;
                            const costPerToken = c.costPerToken || 0;
                            const estCost = used * costPerToken;
                            const budget = c.monthlyBudget || 0;
                            const usagePct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                            const costPct = budget > 0 ? Math.min(100, Math.round((estCost / budget) * 100)) : 0;
                            const isOverBudget = budget > 0 && estCost > budget;
                            const isNearLimit = limit > 0 && usagePct >= 80;

                            const providerLabel = c.providerType ? c.providerType.charAt(0).toUpperCase() + c.providerType.slice(1) : 'Unknown';

                            return (
                                <div key={c._id} className={`bg-white rounded-2xl shadow border-2 overflow-hidden ${c.isActive ? 'border-green-500' : 'border-gray-100'}`}>

                                    {/* Card header */}
                                    <div className={`px-5 py-4 flex justify-between items-center ${c.isActive ? 'bg-green-50' : 'bg-gray-50'}`}>
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-xl ${c.isActive ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'}`}>
                                                <Cpu className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-bold text-gray-800">{providerLabel}</h3>
                                                    {c.isActive && (
                                                        <span className="flex items-center gap-1 text-xs text-green-600 font-medium bg-green-100 px-2 py-0.5 rounded-full">
                                                            <Activity className="h-3 w-3" /> Active
                                                        </span>
                                                    )}
                                                    {isNearLimit && !isOverBudget && (
                                                        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">Near Limit</span>
                                                    )}
                                                    {isOverBudget && (
                                                        <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">
                                                            <AlertCircle className="h-3 w-3" /> Over Budget
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-gray-500 mt-0.5">{c.aiModel || 'No model set'}</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleResetSingle(c._id, providerLabel)}
                                                disabled={resettingId === c._id}
                                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                                title="Reset usage for this provider"
                                            >
                                                <RefreshCw className={`h-4 w-4 ${resettingId === c._id ? 'animate-spin' : ''}`} />
                                            </button>
                                            <button onClick={() => handleEdit(c)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                                                <Edit className="h-4 w-4" />
                                            </button>
                                            <button onClick={() => handleDelete(c._id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
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
                                                    {used.toLocaleString()} {limit > 0 && `/ ${limit.toLocaleString()}`}
                                                </span>
                                            </div>
                                            {limit > 0 ? (
                                                <>
                                                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                                                        <div
                                                            className={`h-2.5 rounded-full transition-all ${usagePct >= 90 ? 'bg-red-500' : usagePct >= 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                                                            style={{ width: `${usagePct}%` }}
                                                        />
                                                    </div>
                                                    <p className="text-right text-[10px] text-gray-400 mt-0.5">{usagePct}% of limit</p>
                                                </>
                                            ) : (
                                                <div className="text-xs text-gray-400 italic">No token limit set — unlimited</div>
                                            )}
                                        </div>

                                        {/* Estimated cost */}
                                        <div>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                                    <DollarSign className="h-3.5 w-3.5 text-green-500" />
                                                    Estimated Cost
                                                </span>
                                                <span className={`text-sm font-bold ${isOverBudget ? 'text-red-600' : 'text-gray-800'}`}>
                                                    ${estCost.toFixed(4)}
                                                </span>
                                            </div>
                                            {budget > 0 ? (
                                                <>
                                                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                                                        <div
                                                            className={`h-2.5 rounded-full transition-all ${isOverBudget ? 'bg-red-500' : costPct >= 80 ? 'bg-amber-500' : 'bg-green-500'}`}
                                                            style={{ width: `${Math.min(100, costPct)}%` }}
                                                        />
                                                    </div>
                                                    <p className="text-right text-[10px] text-gray-400 mt-0.5">
                                                        ${estCost.toFixed(4)} of ${budget.toFixed(2)} budget
                                                    </p>
                                                </>
                                            ) : (
                                                <div className="text-xs text-gray-400 italic">No monthly budget set</div>
                                            )}
                                        </div>

                                        {/* Meta row */}
                                        <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-[11px] text-gray-400">
                                            <span>
                                                {c.lastResetAt
                                                    ? `Last reset: ${new Date(c.lastResetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                                                    : 'Never reset'}
                                            </span>
                                            <span>${(costPerToken * 1000).toFixed(5)}/1K tokens</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Local NLP Cache Card */}
                        {(() => {
                            const nlpConfig = configs.find(c => c.key === 'LOCAL_NLP_ENABLED');
                            const isNLPActive = nlpConfig?.value === 'true';
                            return (
                                <div className="bg-gray-50 rounded-2xl shadow border border-gray-200 overflow-hidden">
                                    <div className="px-5 py-4 bg-gray-100 flex justify-between items-center">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-xl ${isNLPActive ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-500'}`}>
                                                <Bot className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-gray-800">Local NLP Cache</h3>
                                                {isNLPActive && (
                                                    <span className="text-xs text-purple-600 font-medium">Active & Learning</span>
                                                )}
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" className="sr-only peer" checked={isNLPActive} onChange={toggleLocalNLP} />
                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600" />
                                        </label>
                                    </div>
                                    <div className="px-5 py-4">
                                        <p className="text-sm text-gray-600">
                                            Learns from AI responses and caches repetitive queries locally — avoids unnecessary API calls and saves tokens.
                                        </p>
                                        {isNLPActive && (
                                            <div className="mt-3 flex items-center gap-2 text-xs text-purple-700 bg-purple-50 px-3 py-2 rounded-lg">
                                                <Activity className="h-3.5 w-3.5" />
                                                Tokens saved by NLP cache are NOT counted in usage above
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {aiConfigs.length === 0 && (
                            <div className="col-span-2 text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300">
                                <Cpu className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                                <p className="text-gray-500 font-medium">No AI providers configured</p>
                                <p className="text-gray-400 text-sm mt-1">Click "Add New" to set up OpenAI, Gemini, Groq, etc.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'general' && (
                <div className="bg-white rounded-xl shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {generalConfigs.map(c => (
                                    <tr key={c._id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{c.key}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 break-all max-w-xs truncate">{c.value}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.description}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button onClick={() => handleEdit(c)} className="text-indigo-600 hover:text-indigo-900 mr-4">
                                                <Edit className="h-4 w-4" />
                                            </button>
                                            <button onClick={() => handleDelete(c._id)} className="text-red-600 hover:text-red-900">
                                                <Trash className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {generalConfigs.length === 0 && (
                        <div className="p-8 text-center text-gray-500">No general configs found.</div>
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
                                <div className={`p-4 rounded mb-6 ${voiceMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {voiceMessage.text}
                                </div>
                            )}

                            {/* Waterfall routing info banner */}
                            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
                                <p className="font-semibold mb-1">📡 Smart Waterfall Routing</p>
                                <p>The system automatically falls back to the next available provider if the active one fails. For <strong>Sinhala</strong>, Google Free TTS is always used (the only engine with native Sinhala support).</p>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                                {/* Google Free TTS Card */}
                                <div className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${activeVoiceProvider === 'google-free' ? 'border-green-500 shadow-green-100' : 'border-gray-200'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-lg text-gray-800">Google Free TTS</h3>
                                            <p className="text-xs text-gray-500">Free · Sinhala / Tamil / English</p>
                                        </div>
                                        {activeVoiceProvider === 'google-free' && (
                                            <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                                                <Activity className="w-3 h-3 mr-1" /> Active
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1 space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Response Mode</label>
                                            <select
                                                value={getProviderConfig('google-free').mode}
                                                onChange={(e) => updateProviderConfig('google-free', { mode: e.target.value as VoiceConfigData['mode'] })}
                                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:outline-none"
                                            >
                                                <option value="voice-and-text">Voice & Text</option>
                                                <option value="voice-only">Voice Only</option>
                                                <option value="text-only">Text Only</option>
                                            </select>
                                        </div>
                                        <div className="bg-green-50 p-3 rounded text-sm text-green-800 border border-green-100">
                                            ✅ No API Key required. Uses the free Google TTS package. The <strong>only</strong> engine that supports Sinhala — automatically selected for Sinhala voice replies.
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
                                <div className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${activeVoiceProvider === 'google-cloud' ? 'border-blue-500 shadow-blue-100' : 'border-gray-200'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-lg text-gray-800">Google Cloud TTS</h3>
                                            <p className="text-xs text-gray-500">Neural2 Voices · English, Tamil, Hindi</p>
                                        </div>
                                        {activeVoiceProvider === 'google-cloud' && (
                                            <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                                                <Activity className="w-3 h-3 mr-1" /> Active
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1 space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Response Mode</label>
                                            <select
                                                value={getProviderConfig('google-cloud').mode}
                                                onChange={(e) => updateProviderConfig('google-cloud', { mode: e.target.value as VoiceConfigData['mode'] })}
                                                className="w-full p-2 border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                            >
                                                <option value="voice-and-text">Voice & Text</option>
                                                <option value="voice-only">Voice Only</option>
                                                <option value="text-only">Text Only</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-blue-900 mb-1">Google Cloud API Key</label>
                                            <p className="text-xs text-gray-500 mb-2">
                                                Create at <strong>console.cloud.google.com</strong> → APIs &amp; Services → Credentials → Create API Key. Enable <em>Cloud Text-to-Speech API</em> in your project.
                                            </p>
                                            <input
                                                type="password"
                                                value={getProviderConfig('google-cloud').googleApiKey || ''}
                                                onChange={(e) => updateProviderConfig('google-cloud', { googleApiKey: e.target.value })}
                                                placeholder="AIza..."
                                                className="w-full p-2 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-blue-900 mb-1">Neural2 Voice</label>
                                            <select
                                                value={getProviderConfig('google-cloud').voiceId || 'en-US-Neural2-F'}
                                                onChange={(e) => updateProviderConfig('google-cloud', { voiceId: e.target.value })}
                                                className="w-full p-2 text-sm border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                            >
                                                <option value="en-US-Neural2-F">English — Neural2-F (Female)</option>
                                                <option value="en-US-Neural2-D">English — Neural2-D (Male)</option>
                                                <option value="en-US-Neural2-A">English — Neural2-A (Male)</option>
                                                <option value="ta-IN-Neural2-B">Tamil — Neural2-B (Female)</option>
                                                <option value="ta-IN-Neural2-A">Tamil — Neural2-A (Male)</option>
                                                <option value="hi-IN-Neural2-A">Hindi — Neural2-A (Female)</option>
                                                <option value="hi-IN-Neural2-B">Hindi — Neural2-B (Male)</option>
                                            </select>
                                        </div>
                                        <div className="bg-blue-50 p-3 rounded text-xs text-blue-700 border border-blue-100">
                                            ⚠️ Sinhala is <strong>not supported</strong> by Google Cloud TTS — Sinhala replies automatically use Google Free TTS regardless of this setting.
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

                                {/* OpenAI TTS Card */}
                                <div className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${activeVoiceProvider === 'openai' ? 'border-green-500 shadow-green-100' : 'border-gray-200'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-lg text-gray-800">OpenAI Voice</h3>
                                            <p className="text-xs text-gray-500">High Quality · Lifelike Speech</p>
                                        </div>
                                        {activeVoiceProvider === 'openai' && (
                                            <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                                                <Activity className="w-3 h-3 mr-1" /> Active
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1 space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Response Mode</label>
                                            <select
                                                value={getProviderConfig('openai').mode}
                                                onChange={(e) => updateProviderConfig('openai', { mode: e.target.value as VoiceConfigData['mode'] })}
                                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:outline-none"
                                            >
                                                <option value="voice-and-text">Voice & Text</option>
                                                <option value="voice-only">Voice Only</option>
                                                <option value="text-only">Text Only</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                                            <input
                                                type="password"
                                                value={getProviderConfig('openai').apiKey || ''}
                                                onChange={(e) => updateProviderConfig('openai', { apiKey: e.target.value })}
                                                placeholder="sk-..."
                                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:outline-none"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">Quality</label>
                                                <select
                                                    value={getProviderConfig('openai').ttsModel || 'tts-1'}
                                                    onChange={(e) => updateProviderConfig('openai', { ttsModel: e.target.value as VoiceConfigData['ttsModel'] })}
                                                    className="w-full p-1.5 text-sm border border-gray-300 rounded"
                                                >
                                                    <option value="tts-1">Standard</option>
                                                    <option value="tts-1-hd">HD</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">Persona</label>
                                                <select
                                                    value={getProviderConfig('openai').voiceId || 'nova'}
                                                    onChange={(e) => updateProviderConfig('openai', { voiceId: e.target.value })}
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
                                <div className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${activeVoiceProvider === 'elevenlabs' ? 'border-purple-500 shadow-purple-100' : 'border-gray-200'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-lg text-gray-800">ElevenLabs</h3>
                                            <p className="text-xs text-gray-500">Premium · Voice Cloning</p>
                                        </div>
                                        {activeVoiceProvider === 'elevenlabs' && (
                                            <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                                                <Activity className="w-3 h-3 mr-1" /> Active
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1 space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Response Mode</label>
                                            <select
                                                value={getProviderConfig('elevenlabs').mode}
                                                onChange={(e) => updateProviderConfig('elevenlabs', { mode: e.target.value as VoiceConfigData['mode'] })}
                                                className="w-full p-2 border border-purple-200 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                            >
                                                <option value="voice-and-text">Voice & Text</option>
                                                <option value="voice-only">Voice Only</option>
                                                <option value="text-only">Text Only</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-purple-900 mb-2">API Key</label>
                                            <input
                                                type="password"
                                                value={getProviderConfig('elevenlabs').apiKey || ''}
                                                onChange={(e) => updateProviderConfig('elevenlabs', { apiKey: e.target.value })}
                                                placeholder="API Key"
                                                className="w-full p-2 border border-purple-200 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-purple-900 mb-2">Engine Model</label>
                                            <select
                                                value={getProviderConfig('elevenlabs').ttsModel || 'eleven_multilingual_v2'}
                                                onChange={(e) => updateProviderConfig('elevenlabs', { ttsModel: e.target.value as VoiceConfigData['ttsModel'] })}
                                                className="w-full p-2 border border-purple-200 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                            >
                                                <option value="eleven_multilingual_v2">Multilingual v2</option>
                                                <option value="eleven_monolingual_v1">Monolingual v1</option>
                                                <option value="eleven_turbo_v2">Turbo v2</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-purple-900 mb-2">Voice Clone ID</label>
                                            <input
                                                value={getProviderConfig('elevenlabs').voiceId || ''}
                                                onChange={(e) => updateProviderConfig('elevenlabs', { voiceId: e.target.value })}
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

                            </div>
                        </>
                    )}
                </div>
            )
            }
        </div >
    );
}
