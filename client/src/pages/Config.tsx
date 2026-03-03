import { useState, useEffect } from 'react';
import { api } from '../config';
import { Plus, Trash, Edit, Save, X, Bot, Settings, Activity, Cpu, Mic } from 'lucide-react';

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
    isActive?: boolean;
}

interface VoiceConfigData {
    provider: 'google-free' | 'openai' | 'elevenlabs';
    apiKey?: string;
    voiceId?: string;
    isActive?: boolean;
    mode: 'voice-only' | 'text-only' | 'voice-and-text';
    ttsModel?: 'tts-1' | 'tts-1-hd' | 'eleven_multilingual_v2' | 'eleven_monolingual_v1' | 'eleven_turbo_v2';
}

export default function Config() {
    const [configs, setConfigs] = useState<Config[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'general' | 'ai' | 'voice'>('ai');

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
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchConfigs();
        fetchVoiceConfig();
    }, []);

    const handleDelete = async (id: string) => {
        if (window.confirm('Are you sure you want to delete this configuration?')) {
            try {
                await api.delete(`/api/config/${id}`);
                fetchConfigs();
                alert('Configuration deleted successfully.');
            } catch (err: any) {
                console.error('Failed to delete config:', err);
                alert(`Failed to delete configuration: ${err.response?.data?.error || err.message}`);
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
            const message = err instanceof Error ? err.message : String(err);
            alert('Error saving: ' + message);
        }
    };

    const toggleLocalNLP = async () => {
        const nlpConfig = configs.find(c => c.key === 'LOCAL_NLP_ENABLED');
        if (nlpConfig) {
            const newValue = nlpConfig.value === 'true' ? 'false' : 'true';
            try {
                await api.put(`/api/config/${nlpConfig._id}`, { ...nlpConfig, value: newValue });
                fetchConfigs();
            } catch (err) {
                alert('Error updating Local NLP config');
            }
        }
    };

    const handleSaveVoiceProvider = async (providerName: string) => {
        setVoiceSaving(true);
        setVoiceMessage(null);
        try {
            const configToSave = voiceConfigs.find((c: any) => c.provider === providerName) || { provider: providerName, mode: 'voice-and-text' };
            await api.post('/api/voice-config', configToSave);
            setVoiceMessage({ type: 'success', text: `${providerName} voice configuration activated successfully!` });
            fetchVoiceConfig(); // Refresh to update sorting and active status
        } catch (error) {
            console.error('Failed to save config', error);
            setVoiceMessage({ type: 'error', text: `Failed to save ${providerName} configuration.` });
        } finally {
            setVoiceSaving(false);
        }
    };

    const updateProviderConfig = (providerName: string, updates: any) => {
        setVoiceConfigs((prev: any[]) => {
            const exists = prev.find((c: any) => c.provider === providerName);
            if (exists) {
                return prev.map((c: any) => c.provider === providerName ? { ...c, ...updates } : c);
            } else {
                return [...prev, { provider: providerName, mode: 'voice-and-text', ...updates }];
            }
        });
    };

    const getProviderConfig = (providerName: string): VoiceConfigData => {
        const found = voiceConfigs.find((c: any) => c.provider === providerName);
        if (found) return found;

        return {
            provider: providerName as any,
            mode: 'voice-and-text',
            apiKey: '',
            ttsModel: providerName === 'elevenlabs' ? 'eleven_multilingual_v2' : 'tts-1',
            voiceId: providerName === 'elevenlabs' ? '' : 'alloy'
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
                                    <label className="block text-sm font-medium text-gray-700">Token Limit</label>
                                    <input
                                        type="number"
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                                        value={formData.usageLimit || 0}
                                        onChange={e => setFormData({ ...formData, usageLimit: parseInt(e.target.value) })}
                                    />
                                </div>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {aiConfigs.map(c => (
                        <div key={c._id} className={`bg-white p-6 rounded-xl shadow border-2 ${c.isActive ? 'border-green-500' : 'border-transparent'}`}>
                            <div className="flex justify-between items-start">
                                <div className="flex items-center">
                                    <div className={`p-2 rounded-lg ${c.isActive ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}>
                                        <Cpu className="h-6 w-6" />
                                    </div>
                                    <div className="ml-3">
                                        <h3 className="text-lg font-bold capitalize">{c.providerType}</h3>
                                        <p className="text-sm text-gray-500">{c.aiModel}</p>
                                    </div>
                                </div>
                                <div className="flex space-x-2">
                                    <button onClick={() => handleEdit(c)} className="p-2 text-gray-400 hover:text-blue-600">
                                        <Edit className="h-4 w-4" />
                                    </button>
                                    <button onClick={() => handleDelete(c._id)} className="p-2 text-gray-400 hover:text-red-600">
                                        <Trash className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                                <div className="bg-gray-50 p-3 rounded-lg">
                                    <p className="text-gray-500 text-xs">Usage</p>
                                    <p className="font-semibold">{c.usageUsed?.toLocaleString()} tokens</p>
                                </div>
                                <div className="bg-gray-50 p-3 rounded-lg">
                                    <p className="text-gray-500 text-xs">Est. Cost</p>
                                    <p className="font-semibold">${((c.usageUsed || 0) * (c.costPerToken || 0)).toFixed(4)}</p>
                                </div>
                            </div>

                            {c.isActive && (
                                <div className="mt-4 flex items-center text-green-600 text-sm font-medium">
                                    <Activity className="h-4 w-4 mr-1" /> Active
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Local NLP Cache Card */}
                    {(() => {
                        const nlpConfig = configs.find(c => c.key === 'LOCAL_NLP_ENABLED');
                        const isNLPActive = nlpConfig?.value === 'true';
                        return (
                            <div className={`bg-gray-50 p-6 rounded-xl shadow border border-gray-200`}>
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center">
                                        <div className={`p-2 rounded-lg ${isNLPActive ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-500'}`}>
                                            <Bot className="h-6 w-6" />
                                        </div>
                                        <div className="ml-3">
                                            <h3 className="text-lg font-bold">Local NLP Cache</h3>
                                            <p className="text-xs text-gray-500 max-w-xs">Learns from AI responses and automatically handles repetitive queries without calling the API, saving tokens.</p>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" className="sr-only peer" checked={isNLPActive} onChange={toggleLocalNLP} />
                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                                        </label>
                                    </div>
                                </div>
                                {isNLPActive ? (
                                    <div className="mt-2 flex items-center text-purple-600 text-sm font-medium">
                                        <Activity className="h-4 w-4 mr-1" /> Active & Learning
                                    </div>
                                ) : (
                                    <div className="mt-2 flex items-center text-gray-500 text-sm font-medium">
                                        Disabled
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {aiConfigs.length === 0 && (
                        <div className="col-span-2 text-center py-12 bg-white rounded-xl border border-dashed border-gray-300 text-gray-500">
                            No AI providers configured. Click "Add New" to set up OpenAI, Gemini, etc.
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

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Google TTS Card */}
                                <div className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${activeVoiceProvider === 'google-free' ? 'border-green-500 shadow-green-100' : 'border-transparent'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-lg text-gray-800">Google TTS</h3>
                                            <p className="text-xs text-gray-500">Free, Standard Voice</p>
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
                                                onChange={(e) => updateProviderConfig('google-free', { mode: e.target.value })}
                                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                            >
                                                <option value="voice-and-text">Voice & Text</option>
                                                <option value="voice-only">Voice Only</option>
                                                <option value="text-only">Text Only</option>
                                            </select>
                                        </div>
                                        <div className="bg-gray-50 p-3 rounded text-sm text-gray-600 border border-gray-100 italic">
                                            No API Key required. This uses the default free Google Text-to-Speech package.
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

                                {/* OpenAI TTS Card */}
                                <div className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${activeVoiceProvider === 'openai' ? 'border-green-500 shadow-green-100' : 'border-transparent'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-lg text-gray-800">OpenAI Voice</h3>
                                            <p className="text-xs text-gray-500">High Quality, Lifelike Speech</p>
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
                                                onChange={(e) => updateProviderConfig('openai', { mode: e.target.value })}
                                                className="w-full p-2 border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                            >
                                                <option value="voice-and-text">Voice & Text</option>
                                                <option value="voice-only">Voice Only</option>
                                                <option value="text-only">Text Only</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-blue-900 mb-2">API Key</label>
                                            <input
                                                type="password"
                                                value={getProviderConfig('openai').apiKey || ''}
                                                onChange={(e) => updateProviderConfig('openai', { apiKey: e.target.value })}
                                                placeholder="sk-..."
                                                className="w-full p-2 border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-xs font-medium text-blue-900 mb-1">Quality</label>
                                                <select
                                                    value={getProviderConfig('openai').ttsModel || 'tts-1'}
                                                    onChange={(e) => updateProviderConfig('openai', { ttsModel: e.target.value })}
                                                    className="w-full p-1.5 text-sm border border-blue-200 rounded"
                                                >
                                                    <option value="tts-1">Standard</option>
                                                    <option value="tts-1-hd">HD</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-blue-900 mb-1">Persona</label>
                                                <select
                                                    value={getProviderConfig('openai').voiceId || 'alloy'}
                                                    onChange={(e) => updateProviderConfig('openai', { voiceId: e.target.value })}
                                                    className="w-full p-1.5 text-sm border border-blue-200 rounded"
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
                                        className="mt-6 w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50"
                                    >
                                        <Save className="h-4 w-4 mr-2" /> Save & Activate
                                    </button>
                                </div>

                                {/* ElevenLabs Card */}
                                <div className={`bg-white shadow-lg rounded-xl border-2 transition-all p-6 flex flex-col ${activeVoiceProvider === 'elevenlabs' ? 'border-green-500 shadow-green-100' : 'border-transparent'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-lg text-gray-800">ElevenLabs</h3>
                                            <p className="text-xs text-gray-500">Premium Voice Cloning</p>
                                        </div>
                                        {activeVoiceProvider === 'elevenlabs' && (
                                            <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full uppercase flex items-center">
                                                <Activity className="w-3 h-3 mr-1" /> Active
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex-1 space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Response Mode</label>
                                            <select
                                                value={getProviderConfig('elevenlabs').mode}
                                                onChange={(e) => updateProviderConfig('elevenlabs', { mode: e.target.value })}
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
                                                onChange={(e) => updateProviderConfig('elevenlabs', { ttsModel: e.target.value })}
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
