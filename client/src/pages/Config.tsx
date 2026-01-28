import { useState, useEffect } from 'react';
import { api } from '../config';
import { Plus, Trash, Edit, Save, X, Bot, Settings, Activity, Cpu } from 'lucide-react';

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

export default function Config() {
    const [configs, setConfigs] = useState<Config[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'general' | 'ai'>('ai');

    // Default form data
    const [formData, setFormData] = useState<Partial<Config>>({
        key: '', value: '', description: '',
        isProvider: false, providerType: 'openai',
        apiKey: '', aiModel: '', isActive: false
    });

    useEffect(() => {
        fetchConfigs();
    }, []);

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

    const handleDelete = async (id: string) => {
        if (window.confirm('Are you sure?')) {
            await api.delete(`/api/config/${id}`);
            fetchConfigs();
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
            // For AI providers, key should be unique, so we generate one if not set
            if (formData.isProvider && !formData.key) {
                formData.key = `provider_${formData.providerType}_${Date.now()}`;
            }

            if (editingId) {
                await api.put(`/api/config/${editingId}`, formData);
            } else {
                await api.post('/api/config', formData);
            }
            setIsEditing(false);
            fetchConfigs();
        } catch (err: any) {
            alert('Error saving: ' + err.message);
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
                                    placeholder="e.g. gpt-4-turbo"
                                />
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
                    {generalConfigs.length === 0 && (
                        <div className="p-8 text-center text-gray-500">No general configs found.</div>
                    )}
                </div>
            )}
        </div>
    );
}
