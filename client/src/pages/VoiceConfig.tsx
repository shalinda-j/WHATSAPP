import { useState, useEffect } from 'react';
import { api } from '../config';
import { Activity } from 'lucide-react';

interface VoiceConfigData {
    provider: 'google-free' | 'openai';
    apiKey?: string;
    voiceId?: string;
    isActive: boolean;
    mode: 'voice-and-text' | 'voice-only' | 'text-only';
    ttsModel?: 'tts-1' | 'tts-1-hd';
}

export default function VoiceConfig() {
    const [config, setConfig] = useState<VoiceConfigData | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const fetchConfig = async () => {
        try {
            const res = await api.get('/api/voice-config');
            setConfig(res.data);
        } catch (error) {
            console.error('Failed to fetch voice config', error);
            setMessage({ type: 'error', text: 'Failed to load configuration' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConfig();
    }, []);

    const handleToggle = async (checked: boolean) => {
        if (!config) return;

        const newConfig = { ...config, isActive: checked };
        setConfig(newConfig);
        setSaving(true);
        setMessage(null);

        try {
            await api.post('/api/voice-config', newConfig);
            setMessage({ type: 'success', text: `Voice Agent ${checked ? 'Enabled' : 'Disabled'}` });
        } catch (error) {
            console.error('Failed to update status', error);
            setMessage({ type: 'error', text: 'Failed to update status' });
            // Revert state on error
            setConfig(config);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Loading voice settings...</div>;
    }

    if (!config) {
        return <div className="p-8 text-center text-red-500">Error loading configuration.</div>;
    }

    return (
        <div className="max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold mb-6">Voice Agent Management</h1>

            {message && (
                <div className={`p-4 rounded mb-6 ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            <div className="bg-white shadow-lg rounded-lg p-6">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center">
                        <Activity className={`mr-3 h-8 w-8 ${config.isActive ? 'text-green-500' : 'text-gray-400'}`} />
                        <div>
                            <h3 className="font-semibold text-gray-900 text-lg">Voice Agent Status</h3>
                            <p className="text-gray-500">Enable or disable the voice agent globally.</p>
                            <p className="text-xs text-gray-400 mt-1">
                                {config.isActive ? 'Agent is active and will reply with voice.' : 'Agent is disabled.'}
                            </p>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.isActive}
                            onChange={(e) => handleToggle(e.target.checked)}
                            className="sr-only peer"
                            disabled={saving}
                        />
                        <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-600"></div>
                    </label>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-sm text-gray-500">
                        For advanced configuration (Provider, API Keys, Models), please visit the <a href="/config" className="text-blue-600 hover:underline">Configuration</a> page.
                    </p>
                </div>
            </div>
        </div>
    );
}
