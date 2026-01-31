import { useState, useEffect } from 'react';
import api from '../utils/api';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Bot, Cpu, TrendingUp, Settings } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

interface AIProvider {
    _id: string;
    providerType: string;
    apiKey?: string;
    aiModel?: string;
    usageLimit?: number;
    usageUsed?: number;
    costPerToken?: number;
    isActive?: boolean;
}

export default function Dashboard() {
    const [status, setStatus] = useState<any>({ status: 'disconnected', qr: null });
    const [loading, setLoading] = useState(true);
    const [aiProviders, setAiProviders] = useState<AIProvider[]>([]);
    const [aiLoading, setAiLoading] = useState(true);

    const fetchStatus = async () => {
        try {
            const res = await api.get('/whatsapp/status');
            setStatus(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchAIProviders = async () => {
        try {
            const res = await api.get('/api/config');
            if (Array.isArray(res.data)) {
                const providers = res.data.filter((config: any) => config.isProvider === true);
                setAiProviders(providers);
            }
        } catch (err) {
            console.error('Failed to fetch AI providers:', err);
        } finally {
            setAiLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchAIProviders();
        const interval = setInterval(() => {
            fetchStatus();
            fetchAIProviders();
        }, 5000); // Poll every 5s
        return () => clearInterval(interval);
    }, []);

    const handleReconnect = async () => {
        try {
            await api.post('/whatsapp/reconnect');
            alert('Reconnection initiated');
            fetchStatus();
        } catch (err) {
            alert('Error initiating reconnection');
        }
    };

    const getStatusColor = (s: string) => {
        switch (s) {
            case 'connected': return 'text-green-600';
            case 'connecting': return 'text-blue-600';
            case 'reconnecting': return 'text-yellow-600';
            case 'scan_qr': return 'text-orange-600';
            default: return 'text-red-600';
        }
    };

    const getStatusIcon = (s: string) => {
        switch (s) {
            case 'connected': return <CheckCircle className="h-6 w-6 mr-2" />;
            case 'connecting': return <RefreshCw className="h-6 w-6 mr-2 animate-spin" />;
            case 'reconnecting': return <RefreshCw className="h-6 w-6 mr-2 animate-spin" />;
            case 'scan_qr': return <AlertTriangle className="h-6 w-6 mr-2" />;
            default: return <XCircle className="h-6 w-6 mr-2" />;
        }
    };

    const getProviderIcon = (type: string) => {
        const iconClass = "h-5 w-5";
        switch (type.toLowerCase()) {
            case 'google':
                return <Bot className={iconClass} />;
            case 'openai':
                return <Cpu className={iconClass} />;
            case 'groq':
                return <TrendingUp className={iconClass} />;
            case 'openrouter':
                return <RefreshCw className={iconClass} />;
            default:
                return <Settings className={iconClass} />;
        }
    };

    const getProviderName = (type: string) => {
        switch (type.toLowerCase()) {
            case 'google': return 'Gemini';
            case 'openai': return 'OpenAI';
            case 'groq': return 'Groq';
            case 'openrouter': return 'OpenRouter';
            case 'anthropic': return 'Claude';
            case 'local': return 'Local';
            default: return type;
        }
    };

    if (loading) return <div>Loading status...</div>;

    const activeProviders = aiProviders.filter(p => p.isActive);
    const totalUsage = aiProviders.reduce((sum, p) => sum + (p.usageUsed || 0), 0);
    const totalCost = aiProviders.reduce((sum, p) => sum + ((p.usageUsed || 0) * (p.costPerToken || 0)), 0);

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                {/* Connection Status Card */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h2 className="text-xl font-semibold mb-4">WhatsApp Connection</h2>

                    <div className={`flex items-center text-lg font-medium mb-4 ${getStatusColor(status.status)}`}>
                        {getStatusIcon(status.status)}
                        <span className="capitalize">{status.status.replace('_', ' ')}</span>
                    </div>

                    {status.status === 'scan_qr' && status.qr && (
                        <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border">
                            <QRCodeCanvas value={status.qr} size={256} />
                            <p className="mt-4 text-sm text-gray-500">Scan with WhatsApp</p>
                        </div>
                    )}

                    {status.status === 'disconnected' && (
                        <button
                            onClick={handleReconnect}
                            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                        >
                            Connect Now
                        </button>
                    )}
                </div>

                {/* System Information */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h2 className="text-xl font-semibold mb-4">System Information</h2>
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span className="text-gray-600">Bot Version</span>
                            <span className="font-medium">0.8.0</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">Mode</span>
                            <span className="font-medium bg-green-100 text-green-800 px-2 py-0.5 rounded text-sm">Active</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">AI Providers</span>
                            <span className="font-medium">{activeProviders.length} active</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* AI Providers Section */}
            <div className="bg-white p-6 rounded-xl shadow-md">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">AI Providers</h2>
                    <a
                        href="/config"
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
                    >
                        <Settings className="h-4 w-4 mr-1" />
                        Configure
                    </a>
                </div>

                {aiLoading ? (
                    <div className="text-center py-8 text-gray-500">Loading AI providers...</div>
                ) : aiProviders.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                        <Bot className="h-12 w-12 mx-auto text-gray-400 mb-3" />
                        <p className="text-gray-600 mb-2">No AI providers configured</p>
                        <a
                            href="/config"
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                            Add your first provider →
                        </a>
                    </div>
                ) : (
                    <>
                        {/* Summary Stats */}
                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <div className="bg-blue-50 p-4 rounded-lg">
                                <p className="text-sm text-blue-600 font-medium">Total Providers</p>
                                <p className="text-2xl font-bold text-blue-900">{aiProviders.length}</p>
                            </div>
                            <div className="bg-green-50 p-4 rounded-lg">
                                <p className="text-sm text-green-600 font-medium">Total Usage</p>
                                <p className="text-2xl font-bold text-green-900">{totalUsage.toLocaleString()}</p>
                                <p className="text-xs text-green-600">tokens</p>
                            </div>
                            <div className="bg-purple-50 p-4 rounded-lg">
                                <p className="text-sm text-purple-600 font-medium">Est. Cost</p>
                                <p className="text-2xl font-bold text-purple-900">${totalCost.toFixed(4)}</p>
                            </div>
                        </div>

                        {/* Provider List */}
                        <div className="space-y-3">
                            {aiProviders.map(provider => (
                                <div
                                    key={provider._id}
                                    className={`flex items-center justify-between p-4 rounded-lg border-2 transition ${provider.isActive
                                        ? 'border-green-200 bg-green-50'
                                        : 'border-gray-200 bg-gray-50'
                                        }`}
                                >
                                    <div className="flex items-center space-x-3">
                                        <div className={`p-2 rounded-lg ${provider.isActive ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'
                                            }`}>
                                            {getProviderIcon(provider.providerType || '')}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold capitalize">
                                                {getProviderName(provider.providerType || '')}
                                            </h3>
                                            <p className="text-sm text-gray-500">{provider.aiModel || 'Default model'}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-4">
                                        <div className="text-right">
                                            <p className="text-sm text-gray-500">Usage</p>
                                            <p className="font-semibold">{(provider.usageUsed || 0).toLocaleString()}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-gray-500">Cost</p>
                                            <p className="font-semibold">
                                                ${((provider.usageUsed || 0) * (provider.costPerToken || 0)).toFixed(4)}
                                            </p>
                                        </div>
                                        <div>
                                            {provider.isActive ? (
                                                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="px-3 py-1 bg-gray-200 text-gray-600 rounded-full text-xs font-medium">
                                                    Inactive
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
