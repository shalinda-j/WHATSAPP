import { useState, useEffect } from 'react';
import { api } from '../config';
import { io } from 'socket.io-client';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Bot, Cpu, TrendingUp, Settings, Plus, Smartphone, Trash2 } from 'lucide-react';
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

interface Session {
    sessionId: string;
    sessionName: string;
    status: 'connected' | 'disconnected' | 'scan_qr' | 'connecting' | 'reconnecting';
    qr?: string | null;
    phoneNumber?: string;
}

interface RecentEvent {
    type: string;
    userId: string;
    content: string;
    timestamp: Date;
    role?: string;
}

export default function Dashboard() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [aiProviders, setAiProviders] = useState<AIProvider[]>([]);
    const [aiLoading, setAiLoading] = useState(true);
    const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);

    const fetchSessions = async () => {
        try {
            const res = await api.get('/api/sessions');
            setSessions(res.data.sessions || []);
            // Auto add default if none exist (legacy support)
            if (res.data.total === 0) {
                await api.post('/api/sessions', { sessionId: 'default', sessionName: 'Primary Device' });
                fetchSessions();
            }
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        fetchSessions();
        fetchAIProviders();

        const API_URL = import.meta.env.VITE_API_URL || window.location.origin;
        const socket = io(API_URL);

        socket.on('new-message', (data) => {
            setRecentEvents(prev => [data, ...prev].slice(0, 5));
            // Trigger background refresh of usage stats occasionally
            if (Math.random() > 0.5) fetchAIProviders();
        });

        const interval = setInterval(() => {
            fetchSessions();
            fetchAIProviders();
        }, 30000); // Polling reduced since WebSockets handle real-time

        return () => {
            clearInterval(interval);
            socket.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleCreateSession = async () => {
        const name = prompt('Enter a name for this device (e.g. Support Phone):');
        if (!name) return;
        try {
            await api.post('/api/sessions', { sessionName: name });
            fetchSessions();
        } catch {
            alert('Failed to create session');
        }
    };

    const handleDeleteSession = async (id: string) => {
        if (!confirm('Are you sure you want to remove this device?')) return;
        try {
            await api.delete(`/api/sessions/${id}`);
            fetchSessions();
        } catch {
            alert('Failed to delete session');
        }
    };

    const getStatusColor = (s: string) => {
        switch (s) {
            case 'connected': return 'text-green-600 bg-green-50 border-green-200';
            case 'connecting': return 'text-blue-600 bg-blue-50 border-blue-200';
            case 'reconnecting': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
            case 'scan_qr': return 'text-orange-600 bg-orange-50 border-orange-200';
            default: return 'text-red-600 bg-red-50 border-red-200';
        }
    };

    const getStatusIcon = (s: string) => {
        switch (s) {
            case 'connected': return <CheckCircle className="h-5 w-5 mr-1" />;
            case 'connecting': return <RefreshCw className="h-5 w-5 mr-1 animate-spin" />;
            case 'reconnecting': return <RefreshCw className="h-5 w-5 mr-1 animate-spin" />;
            case 'scan_qr': return <AlertTriangle className="h-5 w-5 mr-1" />;
            default: return <XCircle className="h-5 w-5 mr-1" />;
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Connection Status Card */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">Connected Devices</h2>
                        <button
                            onClick={handleCreateSession}
                            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 flex items-center transition"
                        >
                            <Plus size={16} className="mr-1" /> Add Device
                        </button>
                    </div>

                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                        {sessions.map((session) => (
                            <div key={session.sessionId} className="border rounded-lg p-4 transition hover:shadow-md">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center">
                                        <div className="bg-green-100 p-2 rounded-full mr-3 text-green-700">
                                            <Smartphone size={20} />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-800">{session.sessionName || session.sessionId}</h3>
                                            <p className="text-xs text-gray-500 font-mono">{session.sessionId}</p>
                                        </div>
                                    </div>
                                    <div className={`flex items-center text-sm px-2 py-1 rounded-full border ${getStatusColor(session.status)}`}>
                                        {getStatusIcon(session.status)}
                                        <span className="capitalize font-medium">{(session.status || 'disconnected').replace('_', ' ')}</span>
                                    </div>
                                </div>

                                {session.status === 'scan_qr' && session.qr && (
                                    <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border mb-3">
                                        <QRCodeCanvas value={session.qr} size={150} />
                                        <p className="mt-2 text-xs text-gray-500">Scan with WhatsApp</p>
                                    </div>
                                )}

                                <div className="flex justify-end pt-2 border-t border-gray-100">
                                    <button
                                        onClick={() => handleDeleteSession(session.sessionId)}
                                        className="text-red-500 hover:text-red-700 text-xs flex items-center"
                                    >
                                        <Trash2 size={14} className="mr-1" /> Remove
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* System Information */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h2 className="text-xl font-semibold mb-4">System Information</h2>
                    <div className="space-y-4">
                        <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-600">Bot Version</span>
                            <span className="font-medium">0.8.0</span>
                        </div>
                        <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-600">Mode</span>
                            <span className="font-medium bg-green-100 text-green-800 px-2 py-0.5 rounded text-sm">Active</span>
                        </div>
                        <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-600">AI Providers</span>
                            <span className="font-medium">{activeProviders.length} active</span>
                        </div>
                        <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-600">Connected Devices</span>
                            <span className="font-medium">{sessions.filter(s => s.status === 'connected').length}</span>
                        </div>
                    </div>

                    {/* Live Event Ticker */}
                    <div className="mt-6">
                        <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center">
                            <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
                            Live Activity Stream
                        </h3>
                        <div className="space-y-2 max-h-[150px] overflow-y-auto">
                            {recentEvents.length === 0 ? (
                                <p className="text-xs text-gray-400 italic">Waiting for new messages...</p>
                            ) : (
                                recentEvents.map((evt, idx) => (
                                    <div key={idx} className="text-xs p-2 bg-gray-50 rounded border flex justify-between">
                                        <span className="truncate flex-1 font-medium text-gray-700">
                                            {evt.role === 'user' ? '👤 User:' : '🤖 Bot:'} {evt.content}
                                        </span>
                                        <span className="text-gray-400 ml-2 whitespace-nowrap">
                                            {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : ''}
                                        </span>
                                    </div>
                                ))
                            )}
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
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
                                        <div className="hidden sm:block text-right">
                                            <p className="text-sm text-gray-500">Usage</p>
                                            <p className="font-semibold">{(provider.usageUsed || 0).toLocaleString()}</p>
                                        </div>
                                        <div className="hidden sm:block text-right">
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
