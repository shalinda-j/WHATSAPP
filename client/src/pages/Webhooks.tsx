import { useState, useEffect } from 'react';
import { api } from '../config';
import { Plus, Trash, Globe, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface Webhook {
    _id: string;
    name: string;
    url: string;
    events: string[];
    secret?: string;
    isActive: boolean;
    createdAt: string;
}

export default function Webhooks() {
    const [webhooks, setWebhooks] = useState<Webhook[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    // Form inputs
    const [newName, setNewName] = useState('');
    const [newUrl, setNewUrl] = useState('');
    const [newSecret, setNewSecret] = useState('');

    const fetchWebhooks = async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/webhooks');
            setWebhooks(res.data);
        } catch (error) {
            console.error('Failed to fetch webhooks', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWebhooks();
    }, []);

    const handleCreateWebhook = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName || !newUrl) return;

        setCreating(true);
        try {
            await api.post('/api/webhooks', {
                name: newName,
                url: newUrl,
                secret: newSecret,
                events: ['*'], // Default to all events for now
                isActive: true
            });
            setNewName('');
            setNewUrl('');
            setNewSecret('');
            fetchWebhooks();
        } catch {
            alert('Failed to create webhook');
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteWebhook = async (id: string) => {
        if (!confirm('Are you sure you want to delete this webhook?')) return;
        try {
            await api.delete(`/api/webhooks/${id}`);
            fetchWebhooks();
        } catch {
            alert('Failed to delete webhook');
        }
    };

    const toggleActive = async (webhook: Webhook) => {
        try {
            await api.put(`/api/webhooks/${webhook._id}`, { isActive: !webhook.isActive });
            fetchWebhooks();
        } catch {
            alert('Failed to update webhook');
        }
    };

    return (
        <div>
            <header className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Webhooks</h1>
                    <p className="text-gray-500 mt-2">Connect your bot to external systems</p>
                </div>
                <button
                    onClick={fetchWebhooks}
                    className="p-2 text-gray-500 hover:text-blue-600 transition"
                >
                    <RefreshCw className="w-5 h-5" />
                </button>
            </header>

            {/* Create Form */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-8">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                    <Plus className="w-5 h-5 text-blue-500" />
                    Add New Webhook
                </h3>
                <form onSubmit={handleCreateWebhook} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <input
                        type="text"
                        placeholder="Name (e.g. Hotel CRM)"
                        className="p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        required
                    />
                    <input
                        type="url"
                        placeholder="Endpoint URL (https://...)"
                        className="p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none md:col-span-2"
                        value={newUrl}
                        onChange={(e) => setNewUrl(e.target.value)}
                        required
                    />
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Secret (Optional)"
                            className="p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-full"
                            value={newSecret}
                            onChange={(e) => setNewSecret(e.target.value)}
                        />
                        <button
                            type="submit"
                            disabled={creating}
                            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                        >
                            {creating ? 'Adding...' : 'Add'}
                        </button>
                    </div>
                </form>
            </div>

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <RefreshCw className="w-8 h-8 animate-spin text-gray-300" />
                </div>
            ) : webhooks.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    <Globe className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No webhooks configured yet.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {webhooks.map((hook) => (
                        <div key={hook._id} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-1">
                                    <h3 className="font-bold text-gray-800">{hook.name}</h3>
                                    <span className={`px-2 py-0.5 text-xs rounded-full ${hook.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                        {hook.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <code className="text-sm text-gray-500 bg-gray-50 px-2 py-1 rounded">{hook.url}</code>
                                <div className="mt-2 flex gap-2">
                                    {hook.events.map(ev => (
                                        <span key={ev} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-md">{ev}</span>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => toggleActive(hook)}
                                    className={`p-2 rounded-full transition ${hook.isActive ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                                    title={hook.isActive ? "Deactivate" : "Activate"}
                                >
                                    {hook.isActive ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={() => handleDeleteWebhook(hook._id)}
                                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition"
                                    title="Delete"
                                >
                                    <Trash className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
