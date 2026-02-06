import { useState, useEffect } from 'react';
import { api } from '../config';
import { Save, Mic, Activity, Key, Server, Volume2 } from 'lucide-react';

interface VoiceConfigData {
    provider: 'google-free' | 'openai' | 'elevenlabs';
    apiKey?: string;
    voiceId?: string;
    isActive: boolean;
    mode: 'voice-only' | 'text-only' | 'voice-and-text';
}

export default function VoiceConfig() {
    const [config, setConfig] = useState<VoiceConfigData>({
        provider: 'google-free',
        isActive: true,
        mode: 'voice-and-text'
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const response = await api.get('/api/voice-config');
            setConfig(response.data);
        } catch (error) {
            console.error('Failed to fetch config', error);
            setMessage({ type: 'error', text: 'Failed to load configuration.' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);
        try {
            await api.post('/api/voice-config', config);
            setMessage({ type: 'success', text: 'Voice configuration saved successfully!' });
        } catch (error) {
            console.error('Failed to save config', error);
            setMessage({ type: 'error', text: 'Failed to save configuration.' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="text-center p-10">Loading settings...</div>;

    return (
        <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-8 flex items-center text-gray-800">
                <Mic className="mr-3 h-8 w-8 text-blue-600" />
                Voice Agent Configuration
            </h1>

            {message && (
                <div className={`p-4 rounded mb-6 ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            <form onSubmit={handleSave} className="bg-white shadow-lg rounded-lg p-6 space-y-6">

                {/* Active Status */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center">
                        <Activity className={`mr-3 h-6 w-6 ${config.isActive ? 'text-green-500' : 'text-gray-400'}`} />
                        <div>
                            <h3 className="font-semibold text-gray-900">Voice Agent Status</h3>
                            <p className="text-sm text-gray-500">Enable or disable voice replies globally</p>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.isActive}
                            onChange={(e) => setConfig({ ...config, isActive: e.target.checked })}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Provider Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <span className="flex items-center"><Server className="w-4 h-4 mr-2" /> TTS Provider</span>
                        </label>
                        <select
                            value={config.provider}
                            onChange={(e) => setConfig({ ...config, provider: e.target.value as any })}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        >
                            <option value="google-free">Google TTS (Free)</option>
                            <option value="openai">OpenAI TTS (High Quality - Paid)</option>
                            {/* <option value="elevenlabs">ElevenLabs (Premium - Coming Soon)</option> */}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            {config.provider === 'google-free' ? 'Standard robotic voice. No API key required.' : 'Generating high-quality lifelike speech. Requires API Key.'}
                        </p>
                    </div>

                    {/* Mode Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <span className="flex items-center"><Volume2 className="w-4 h-4 mr-2" /> Response Mode</span>
                        </label>
                        <select
                            value={config.mode}
                            onChange={(e) => setConfig({ ...config, mode: e.target.value as any })}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        >
                            <option value="voice-and-text">Voice & Text (Recommended)</option>
                            <option value="voice-only">Voice Only</option>
                            <option value="text-only">Text Only (Disable TTS)</option>
                        </select>
                    </div>
                </div>

                {/* API Key Section (Conditional) */}
                {config.provider !== 'google-free' && (
                    <div className="p-4 border border-blue-100 bg-blue-50 rounded-lg animation-fade-in transition-all">
                        <label className="block text-sm font-medium text-blue-900 mb-2">
                            <span className="flex items-center"><Key className="w-4 h-4 mr-2" /> API Key for {config.provider === 'openai' ? 'OpenAI' : 'Provider'}</span>
                        </label>
                        <input
                            type="password"
                            value={config.apiKey || ''}
                            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                            placeholder={`sk-...`}
                            className="w-full p-2 border border-blue-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-blue-600 mt-1">
                            Your key is stored securely. Leave blank to use system environment variable if set.
                        </p>

                        {config.provider === 'openai' && (
                            <div className="mt-4">
                                <label className="block text-sm font-medium text-blue-900 mb-2">Voice Model</label>
                                <select
                                    value={config.voiceId || 'alloy'}
                                    onChange={(e) => setConfig({ ...config, voiceId: e.target.value })}
                                    className="w-full p-2 border border-blue-200 rounded"
                                >
                                    <option value="alloy">Alloy (Neutral)</option>
                                    <option value="echo">Echo (Male)</option>
                                    <option value="fable">Fable (British)</option>
                                    <option value="onyx">Onyx (Deep Male)</option>
                                    <option value="nova">Nova (Female)</option>
                                    <option value="shimmer">Shimmer (Female)</option>
                                </select>
                            </div>
                        )}
                    </div>
                )}

                {/* Save Button */}
                <div className="pt-4 flex justify-end">
                    <button
                        type="submit"
                        disabled={saving}
                        className="flex items-center bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                        <Save className="mr-2 h-5 w-5" />
                        {saving ? 'Saving...' : 'Save Configuration'}
                    </button>
                </div>
            </form>
        </div>
    );
}
