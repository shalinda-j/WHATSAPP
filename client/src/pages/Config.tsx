import { useState, useEffect } from 'react';
import { api } from '../config';
import { Plus, Trash, Edit, Save, X, Bot, Settings, Activity, Cpu, Mic, Server, Volume2, Key } from 'lucide-react';

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
    isActive: boolean;
    mode: 'voice-only' | 'text-only' | 'voice-and-text';
    ttsModel?: 'tts-1' | 'tts-1-hd';
}

export default function Config() {
    const [configs, setConfigs] = useState<Config[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'general' | 'ai' | 'voice'>('ai');

    // Voice Config State
    const [voiceConfig, setVoiceConfig] = useState<VoiceConfigData>({
        provider: 'google-free',
        isActive: true,
        mode: 'voice-and-text',
        ttsModel: 'tts-1'
    });
    const [voiceGender, setVoiceGender] = useState<'male' | 'female' | 'neutral'>('neutral');
    const [voiceLoading, setVoiceLoading] = useState(true);
    const [voiceSaving, setVoiceSaving] = useState(false);
    const [voiceMessage, setVoiceMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const OPENAI_VOICES = [
        { id: 'alloy', name: 'Alloy (Neutral)', gender: 'neutral' },
        { id: 'echo', name: 'Echo (Male)', gender: 'male' },
        { id: 'fable', name: 'Fable (British Male)', gender: 'male' },
        { id: 'onyx', name: 'Onyx (Deep Male)', gender: 'male' },
        { id: 'nova', name: 'Nova (Female)', gender: 'female' },
        { id: 'shimmer', name: 'Shimmer (Female)', gender: 'female' },
    ];

    const filteredVoices = OPENAI_VOICES.filter(v =>
        voiceGender === 'neutral' ? true : v.gender === voiceGender || v.gender === 'neutral'
    );

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
            } else {
                console.error("Expected array but got:", res.data);
                setConfigs([]);
            }
        } catch (error) {
            console.error("Failed to fetch configs", error);
        }
    };

    const fetchVoiceConfig = async () => {
        try {
            const response = await api.get('/api/voice-config');
            setVoiceConfig(response.data);
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

    const handleSaveVoice = async (e: React.FormEvent) => {
        e.preventDefault();
        setVoiceSaving(true);
        setVoiceMessage(null);
        try {
            await api.post('/api/voice-config', voiceConfig);
            setVoiceMessage({ type: 'success', text: 'Voice configuration saved successfully!' });
        } catch (error) {
            console.error('Failed to save config', error);
            setVoiceMessage({ type: 'error', text: 'Failed to save configuration.' });
        } finally {
            setVoiceSaving(false);
        }
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

                            <form onSubmit={handleSaveVoice} className="bg-white shadow-lg rounded-lg p-6 space-y-6">



                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Provider Selection */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            <span className="flex items-center"><Server className="w-4 h-4 mr-2" /> TTS Provider</span>
                                        </label>
                                        <select
                                            value={voiceConfig.provider}
                                            onChange={(e) => setVoiceConfig({ ...voiceConfig, provider: e.target.value as any })}
                                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                        >
                                            <option value="google-free">Google TTS (Free)</option>
                                            <option value="openai">OpenAI TTS (High Quality - Paid)</option>
                                        </select>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {voiceConfig.provider === 'google-free' ? 'Standard robotic voice. No API key required.' : 'Generating high-quality lifelike speech. Requires API Key.'}
                                        </p>
                                    </div>

                                    {/* Mode Selection */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            <span className="flex items-center"><Volume2 className="w-4 h-4 mr-2" /> Response Mode</span>
                                        </label>
                                        <select
                                            value={voiceConfig.mode}
                                            onChange={(e) => setVoiceConfig({ ...voiceConfig, mode: e.target.value as any })}
                                            className="w-full p-2 border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                        >
                                            <option value="voice-and-text">Voice & Text (Recommended)</option>
                                            <option value="voice-only">Voice Only</option>
                                            <option value="text-only">Text Only (Disable TTS)</option>
                                        </select>
                                    </div>
                                </div>

                                {/* API Key Section (Conditional) */}
                                {voiceConfig.provider !== 'google-free' && (
                                    <div className="p-4 border border-blue-100 bg-blue-50 rounded-lg animation-fade-in transition-all">
                                        <label className="block text-sm font-medium text-blue-900 mb-2">
                                            <span className="flex items-center"><Key className="w-4 h-4 mr-2" /> API Key for {voiceConfig.provider === 'openai' ? 'OpenAI' : 'Provider'}</span>
                                        </label>
                                        <input
                                            type="password"
                                            value={voiceConfig.apiKey || ''}
                                            onChange={(e) => setVoiceConfig({ ...voiceConfig, apiKey: e.target.value })}
                                            placeholder={`sk-...`}
                                            className="w-full p-2 border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                        />
                                        <p className="text-xs text-blue-600 mt-1">
                                            Your key is stored securely. Leave blank to use system environment variable if set.
                                        </p>


                                        {voiceConfig.provider === 'openai' && (
                                            <div className="mt-4 space-y-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium text-blue-900 mb-2">Quality Model</label>
                                                        <select
                                                            value={voiceConfig.ttsModel || 'tts-1'}
                                                            onChange={(e) => setVoiceConfig({ ...voiceConfig, ttsModel: e.target.value as any })}
                                                            className="w-full p-2 border border-blue-200 rounded"
                                                        >
                                                            <option value="tts-1">Standard (tts-1) - Faster</option>
                                                            <option value="tts-1-hd">HD (tts-1-hd) - Higher Quality</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-blue-900 mb-2">Voice Gender Filter</label>
                                                        <div className="flex space-x-2 mt-2">
                                                            {(['male', 'female', 'neutral'] as const).map((g) => (
                                                                <label key={g} className="inline-flex items-center cursor-pointer">
                                                                    <input
                                                                        type="radio"
                                                                        className="form-radio text-blue-600"
                                                                        name="gender"
                                                                        checked={voiceGender === g}
                                                                        onChange={() => setVoiceGender(g)}
                                                                    />
                                                                    <span className="ml-2 capitalize text-sm text-blue-800">{g}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="block text-sm font-medium text-blue-900 mb-2">Voice Persona</label>
                                                    <select
                                                        value={voiceConfig.voiceId || 'alloy'}
                                                        onChange={(e) => setVoiceConfig({ ...voiceConfig, voiceId: e.target.value })}
                                                        className="w-full p-2 border border-blue-200 rounded"
                                                    >
                                                        {filteredVoices.map(voice => (
                                                            <option key={voice.id} value={voice.id}>
                                                                {voice.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Save Button */}
                                <div className="pt-4 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={voiceSaving}
                                        className="flex items-center bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                                    >
                                        <Save className="mr-2 h-5 w-5" />
                                        {voiceSaving ? 'Saving...' : 'Save Configuration'}
                                    </button>
                                </div>
                            </form>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
