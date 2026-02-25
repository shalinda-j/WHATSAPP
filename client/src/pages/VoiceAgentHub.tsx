import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Link } from 'react-router-dom';
import {
    AudioLines,
    Bot,
    Database,
    Globe,
    Users,
    BarChart3,
    Activity,
    CheckCircle2,
    XCircle,
    ChevronRight,
    MessageCircle
} from 'lucide-react';

export default function VoiceAgentHub() {
    const [loading, setLoading] = useState(true);

    // States representing the different modules
    const [voiceConfigs, setVoiceConfigs] = useState<any[]>([]);
    const [globalConfig, setGlobalConfig] = useState<any>(null);
    const [webhooks, setWebhooks] = useState<any[]>([]);
    const [datasets, setDatasets] = useState<any[]>([]);
    const [analytics, setAnalytics] = useState<any>({ totalVoiceNotes: 0, totalCallsRejected: 0 });
    const [recentLeads, setRecentLeads] = useState<any[]>([]);

    useEffect(() => {
        fetchAllData();
    }, []);

    const fetchAllData = async () => {
        setLoading(true);
        try {
            // Fetch everything in parallel
            const [
                voiceRes,
                configRes,
                webhookRes,
                datasetRes,
                analyticsRes,
                leadsRes
            ] = await Promise.all([
                api.get('/api/voice-config').catch(() => ({ data: [] })),
                api.get('/api/config').catch(() => ({ data: null })),
                api.get('/api/webhooks').catch(() => ({ data: [] })),
                api.get('/api/datasets').catch(() => ({ data: [] })),
                api.get('/api/analytics').catch(() => ({ data: {} })),
                api.get('/api/leads?limit=5').catch(() => ({ data: { leads: [] } }))
            ]);

            const vData = Array.isArray(voiceRes.data) ? voiceRes.data : [voiceRes.data];
            setVoiceConfigs(vData);
            setGlobalConfig(configRes.data);
            setWebhooks(Array.isArray(webhookRes.data) ? webhookRes.data : []);
            setDatasets(Array.isArray(datasetRes.data) ? datasetRes.data : []);
            setAnalytics(analyticsRes.data || { totalVoiceNotes: 0, totalCallsRejected: 0 });
            setRecentLeads(leadsRes.data?.leads || []);

        } catch (error) {
            console.error("Failed to load Hub data", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    // Determine Active Providers
    const activeVoiceConfig = voiceConfigs.length > 0 ? voiceConfigs[0] : null; // Since they are sorted by updatedAt desc in DB usually, or we can just pick ElevenLabs if active
    const activeVoiceProvider = activeVoiceConfig?.provider || 'google-free';
    const voiceMode = activeVoiceConfig?.mode || 'voice-and-text';

    const activeAIProvider = globalConfig?.aiProvider || 'gpt-3.5-turbo';
    const systemPromptLength = globalConfig?.systemPrompt?.length || 0;

    const activeWebhooks = webhooks.filter(w => w.isActive);
    const hasActiveWebhook = activeWebhooks.length > 0;

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                        <AudioLines className="mr-3 h-8 w-8 text-indigo-600" />
                        Voice Agent Hub
                    </h1>
                    <p className="text-gray-500 mt-2">Central command for your WhatsApp Voice AI infrastructure</p>
                </div>
                <button
                    onClick={fetchAllData}
                    className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                    <Activity className="h-4 w-4 mr-2" />
                    Refresh Status
                </button>
            </div>

            {/* Quick Stats Banner */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center">
                    <div className="p-3 rounded-full bg-indigo-100 mr-4">
                        <MessageCircle className="h-6 w-6 text-indigo-600" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Voice Notes Processed</p>
                        <p className="text-2xl font-semibold text-gray-900">{analytics.totalVoiceNotes || 0}</p>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center">
                    <div className="p-3 rounded-full bg-red-100 mr-4">
                        <AudioLines className="h-6 w-6 text-red-600" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Calls Auto-Rejected</p>
                        <p className="text-2xl font-semibold text-gray-900">{analytics.totalCallsRejected || 0}</p>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center">
                    <div className="p-3 rounded-full bg-green-100 mr-4">
                        <Users className="h-6 w-6 text-green-600" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Voice Leads</p>
                        <p className="text-2xl font-semibold text-gray-900">{recentLeads.length || 0}</p>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center">
                    <div className="p-3 rounded-full bg-blue-100 mr-4">
                        <Database className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Knowledge Datasets</p>
                        <p className="text-2xl font-semibold text-gray-900">{datasets.length || 0}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* -------------------- LEFT COLUMN (INTEGRATIONS) -------------------- */}
                <div className="lg:col-span-2 space-y-8">

                    {/* Pipeline Map */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 font-medium text-gray-800 flex items-center">
                            <Activity className="h-5 w-5 mr-2 text-indigo-500" />
                            Active Agent Pipeline
                        </div>
                        <div className="p-6">
                            <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
                                {/* Step 1: User */}
                                <div className="flex flex-col items-center">
                                    <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center border-4 border-white shadow-md">
                                        <MessageCircle className="h-8 w-8 text-blue-600" />
                                    </div>
                                    <span className="mt-2 text-sm font-medium">User Voice Note</span>
                                </div>
                                <ChevronRight className="h-8 w-8 text-gray-300 hidden md:block" />

                                {/* Step 2: AI Brain */}
                                <Link to="/config" className="flex flex-col items-center group cursor-pointer">
                                    <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center border-4 border-white shadow-md group-hover:ring-2 ring-purple-400 transition-all">
                                        <Bot className="h-8 w-8 text-purple-600" />
                                    </div>
                                    <span className="mt-2 text-sm font-medium group-hover:text-purple-600">AI Brain ({activeAIProvider})</span>
                                </Link>
                                <ChevronRight className="h-8 w-8 text-gray-300 hidden md:block" />

                                {/* Step 3: TTS Engine */}
                                <Link to="/voice-config" className="flex flex-col items-center group cursor-pointer">
                                    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center border-4 border-white shadow-md group-hover:ring-2 ring-green-400 transition-all">
                                        <AudioLines className="h-8 w-8 text-green-600" />
                                    </div>
                                    <span className="mt-2 text-sm font-medium group-hover:text-green-600">TTS Engine ({activeVoiceProvider})</span>
                                </Link>
                                <ChevronRight className="h-8 w-8 text-gray-300 hidden md:block" />

                                {/* Step 4: Webhooks/n8n */}
                                <Link to="/n8n" className="flex flex-col items-center group cursor-pointer">
                                    <div className={`w-16 h-16 rounded-full flex items-center justify-center border-4 border-white shadow-md transition-all ${hasActiveWebhook ? 'bg-orange-100 group-hover:ring-2 ring-orange-400' : 'bg-gray-100 opacity-50'}`}>
                                        <Globe className={`h-8 w-8 ${hasActiveWebhook ? 'text-orange-600' : 'text-gray-400'}`} />
                                    </div>
                                    <span className={`mt-2 text-sm font-medium ${hasActiveWebhook ? 'group-hover:text-orange-600' : 'text-gray-400'}`}>Automations (n8n)</span>
                                </Link>
                            </div>
                        </div>
                    </div>

                    {/* Component Status Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Voice Configuration */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4">
                                {activeVoiceConfig ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-red-400" />}
                            </div>
                            <div className="flex items-center mb-4">
                                <div className="p-2 bg-indigo-50 rounded-lg mr-3">
                                    <AudioLines className="h-6 w-6 text-indigo-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-800">Voice Synthesis</h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded">
                                    <span className="text-sm text-gray-500">Active Provider</span>
                                    <span className="text-sm font-semibold text-gray-900 capitalize">{activeVoiceProvider.replace('-', ' ')}</span>
                                </div>
                                <div className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded">
                                    <span className="text-sm text-gray-500">Reply Mode</span>
                                    <span className="text-sm font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded capitalize">{voiceMode.replace(/-/g, ' ')}</span>
                                </div>
                                <div className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded">
                                    <span className="text-sm text-gray-500">Model ID</span>
                                    <span className="text-sm font-medium text-gray-800">{activeVoiceConfig?.ttsModel || 'Default'}</span>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <Link to="/voice-config" className="text-sm text-indigo-600 font-medium hover:text-indigo-800 flex items-center">
                                    Manage Voice Agents <ChevronRight className="h-4 w-4 ml-1" />
                                </Link>
                            </div>
                        </div>

                        {/* AI & Brain Configuration */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4">
                                {globalConfig ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-red-400" />}
                            </div>
                            <div className="flex items-center mb-4">
                                <div className="p-2 bg-purple-50 rounded-lg mr-3">
                                    <Bot className="h-6 w-6 text-purple-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-800">LLM Engine</h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded">
                                    <span className="text-sm text-gray-500">Model</span>
                                    <span className="text-sm font-semibold text-gray-900">{activeAIProvider}</span>
                                </div>
                                <div className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded">
                                    <span className="text-sm text-gray-500">System Prompt</span>
                                    <span className="text-sm font-medium text-gray-800">{systemPromptLength > 0 ? `${systemPromptLength} chars` : 'Default'}</span>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <Link to="/config" className="text-sm text-purple-600 font-medium hover:text-purple-800 flex items-center">
                                    Configure AI Model <ChevronRight className="h-4 w-4 ml-1" />
                                </Link>
                            </div>
                        </div>

                        {/* Datasets / Lore */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                    {datasets.length} Active
                                </span>
                            </div>
                            <div className="flex items-center mb-4">
                                <div className="p-2 bg-blue-50 rounded-lg mr-3">
                                    <Database className="h-6 w-6 text-blue-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-800">Knowledge Lore</h3>
                            </div>
                            <p className="text-sm text-gray-500 mb-4 h-10">
                                Connect external datasets and PDFs to give your AI Agent specific company knowledge.
                            </p>
                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <Link to="/datasets" className="text-sm text-blue-600 font-medium hover:text-blue-800 flex items-center">
                                    Manage Datasets <ChevronRight className="h-4 w-4 ml-1" />
                                </Link>
                            </div>
                        </div>

                        {/* n8n Automations */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4">
                                {hasActiveWebhook ? (
                                    <span className="flex h-3 w-3 relative">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                                    </span>
                                ) : (
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-gray-300"></span>
                                )}
                            </div>
                            <div className="flex items-center mb-4">
                                <div className="p-2 bg-orange-50 rounded-lg mr-3">
                                    <Globe className="h-6 w-6 text-orange-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-800">n8n Routing</h3>
                            </div>
                            <p className="text-sm text-gray-500 mb-4 h-10">
                                Route parsed voice transcripts and leads directly to HubSpot, Google Sheets, or CRMs.
                            </p>
                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <Link to="/n8n" className="text-sm text-orange-600 font-medium hover:text-orange-800 flex items-center">
                                    Open n8n Canvas <ChevronRight className="h-4 w-4 ml-1" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

                {/* -------------------- RIGHT COLUMN (ACTIVITY) -------------------- */}
                <div className="space-y-8">
                    {/* Recent Leads Widget */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden text-sm">
                        <div className="bg-gray-50 px-5 py-4 border-b border-gray-200 font-medium text-gray-800 flex items-center justify-between">
                            <div className="flex items-center">
                                <Users className="h-5 w-5 mr-2 text-green-600" />
                                Latest Voice Leads
                            </div>
                            <Link to="/leads" className="text-xs text-indigo-600 hover:text-indigo-800">View All</Link>
                        </div>
                        <div className="p-0">
                            {recentLeads.length > 0 ? (
                                <ul className="divide-y divide-gray-100">
                                    {recentLeads.map((lead, idx) => (
                                        <li key={idx} className="p-4 hover:bg-gray-50 transition-colors">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <p className="font-medium text-gray-900 truncate max-w-[150px]">{lead.phone || lead.userId || 'Unknown'}</p>
                                                    <p className="text-xs text-gray-500 mt-1 uppercase tracking-wider">{lead.intent || 'General'}</p>
                                                </div>
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                                    Captured
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="p-6 text-center text-gray-500 flex flex-col items-center">
                                    <Users className="h-8 w-8 text-gray-300 mb-2" />
                                    <p>No new leads captured</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* How it works info card */}
                    <div className="bg-gradient-to-br from-indigo-800 to-purple-900 rounded-xl shadow-md p-6 text-white relative overflow-hidden">
                        <div className="absolute -right-4 -top-8 opacity-10">
                            <Bot className="h-48 w-48" />
                        </div>
                        <h3 className="text-lg font-bold mb-3 flex items-center">
                            <AudioLines className="h-5 w-5 mr-2 text-indigo-300" />
                            Voice Note Auto-Responder
                        </h3>
                        <p className="text-indigo-100 text-sm leading-relaxed mb-4">
                            WhatsApp strictly prohibits cloud servers from answering live WebRTC voice calls.
                        </p>
                        <p className="text-indigo-100 text-sm leading-relaxed mb-4">
                            To solve this, your agent instantly <strong>rejects</strong> live calls and asks the user to send a Voice Note instead. When they send a Voice Note, the AI listens, thinks, and responds back with a generated Voice Note natively!
                        </p>
                    </div>
                </div>

            </div>
        </div>
    );
}
