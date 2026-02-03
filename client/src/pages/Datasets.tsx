import { useState, useEffect } from 'react';
import api from '../utils/api';
import { Plus, Trash, Edit, Save, X } from 'lucide-react';

// Common preset scopes
const PRESET_SCOPES = ['ALL', 'JCETI', 'GLOBAL', 'SG', 'ISRAEL', 'JAPAN'];

interface Dataset {
    _id: string;
    name: string;
    content: string;
    scope: string; // Now accepts any string for custom companies
    category?: 'company' | 'faq' | 'promotion' | 'other';
    isActive: boolean;
}

export default function Datasets() {
    const [datasets, setDatasets] = useState<Dataset[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Dataset>>({ name: '', content: '', scope: 'ALL', category: 'company', isActive: true });
    const [useCustomScope, setUseCustomScope] = useState(false);
    const [customScope, setCustomScope] = useState('');

    const fetchDatasets = async () => {
        const res = await api.get('/datasets');
        setDatasets(res.data);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchDatasets();
    }, []);

    const handleDelete = async (id: string) => {
        if (window.confirm('Are you sure?')) {
            await api.delete(`/datasets/${id}`);
            fetchDatasets();
        }
    };

    const handleEdit = (ds: Dataset) => {
        setFormData(ds);
        setEditingId(ds._id);
        // Check if scope is a custom one
        const isCustom = !PRESET_SCOPES.includes(ds.scope);
        setUseCustomScope(isCustom);
        setCustomScope(isCustom ? ds.scope : '');
        setIsEditing(true);
    };

    const handleCreate = () => {
        setFormData({ name: '', content: '', scope: 'ALL', category: 'company', isActive: true });
        setEditingId(null);
        setUseCustomScope(false);
        setCustomScope('');
        setIsEditing(true);
    };

    const handleSave = async () => {
        try {
            const dataToSave = {
                ...formData,
                scope: useCustomScope ? customScope.toUpperCase() : formData.scope
            };
            if (editingId) {
                await api.put(`/datasets/${editingId}`, dataToSave);
            } else {
                await api.post('/datasets', dataToSave);
            }
            setIsEditing(false);
            fetchDatasets();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert('Error saving: ' + message);
        }
    };

    if (isEditing) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-md">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-semibold">{editingId ? 'Edit Dataset' : 'New Dataset'}</h2>
                    <button onClick={() => setIsEditing(false)} className="text-gray-500 hover:text-gray-700">
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Name</label>
                        <input
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Scope (Company/Region)</label>
                        <div className="flex items-center gap-4 mt-1">
                            <label className="inline-flex items-center">
                                <input
                                    type="radio"
                                    checked={!useCustomScope}
                                    onChange={() => setUseCustomScope(false)}
                                    className="form-radio"
                                />
                                <span className="ml-2 text-sm">Preset</span>
                            </label>
                            <label className="inline-flex items-center">
                                <input
                                    type="radio"
                                    checked={useCustomScope}
                                    onChange={() => setUseCustomScope(true)}
                                    className="form-radio"
                                />
                                <span className="ml-2 text-sm">New Company</span>
                            </label>
                        </div>
                        {!useCustomScope ? (
                            <select
                                className="mt-2 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                value={formData.scope}
                                onChange={e => setFormData({ ...formData, scope: e.target.value })}
                            >
                                <option value="ALL">ALL (Global Knowledge)</option>
                                <option value="JCETI">JCETI (Training Institute)</option>
                                <option value="GLOBAL">GLOBAL (Workforce Recruitment)</option>
                                <option value="SG">SG (Singapore)</option>
                                <option value="ISRAEL">ISRAEL</option>
                                <option value="JAPAN">JAPAN</option>
                            </select>
                        ) : (
                            <input
                                className="mt-2 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                placeholder="Enter new company name (e.g., KOREA, UAE, QATAR)"
                                value={customScope}
                                onChange={e => setCustomScope(e.target.value)}
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Category</label>
                        <select
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            value={formData.category || 'company'}
                            // @ts-expect-error - legacy code support
                            onChange={e => setFormData({ ...formData, category: e.target.value })}
                        >
                            <option value="company">Company Info</option>
                            <option value="faq">FAQ</option>
                            <option value="promotion">Promotions</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Content</label>

                        {/* File Upload Section */}
                        <div className="mt-1 mb-3 p-4 border-2 border-dashed border-gray-300 rounded-md bg-gray-50 flex flex-col items-center justify-center text-center">
                            <label className="cursor-pointer">
                                <span className="text-blue-600 hover:text-blue-500 font-medium">Upload a file</span>
                                <span className="text-gray-500"> to auto-extract text</span>
                                <input
                                    type="file"
                                    className="hidden"
                                    accept=".pdf,.csv,.xlsx,.xls,image/*,text/plain"
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;

                                        const formData = new FormData();
                                        formData.append('file', file);

                                        try {
                                            // Show loading indicator (you might want to add a proper state for this)
                                            // const originalText = e.target.parentElement?.innerText;
                                            if (e.target.parentElement) e.target.parentElement.innerText = "Extracting...";

                                            const token = localStorage.getItem('token');
                                            const res = await fetch('http://localhost:3000/api/datasets/extract', {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${token}`
                                                },
                                                body: formData
                                            });

                                            const data = await res.json();

                                            if (!res.ok) throw new Error(data.message || 'Extraction failed');

                                            // Append extracted text
                                            setFormData(prev => ({
                                                ...prev,
                                                content: (prev.content ? prev.content + '\n\n' : '') + `[Extracted from ${file.name}]:\n${data.text}`
                                            }));
                                        } catch (err: unknown) { // Explicitly typed as unknown
                                            console.error(err);
                                            // Safely access error message
                                            const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
                                            alert('Failed to extract text: ' + errorMessage);
                                        } finally {
                                            // Reset UI (Basic implementation, improved state handling recommended)
                                            // Ideally we would use a state variable like isExtracting
                                        }
                                    }}
                                />
                            </label>
                            <p className="text-xs text-gray-400 mt-1">Supports PDF, Excel, CSV, Images, Text</p>
                        </div>

                        <textarea
                            rows={15}
                            placeholder="Enter company info, FAQs, or other knowledge the chatbot should use..."
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                            value={formData.content}
                            onChange={e => setFormData({ ...formData, content: e.target.value })}
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
                <h1 className="text-3xl font-bold">Datasets</h1>
                <button
                    onClick={handleCreate}
                    className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                    <Plus className="h-5 w-5 mr-2" /> Add New
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scope</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {datasets.map(ds => (
                                <tr key={ds._id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{ds.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                            {ds.scope}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800 capitalize">
                                            {ds.category || 'company'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{ds.isActive ? '✅' : '❌'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button onClick={() => handleEdit(ds)} className="text-indigo-600 hover:text-indigo-900 mr-4">
                                            <Edit className="h-4 w-4" />
                                        </button>
                                        <button onClick={() => handleDelete(ds._id)} className="text-red-600 hover:text-red-900">
                                            <Trash className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {datasets.length === 0 && (
                    <div className="p-8 text-center text-gray-500">No datasets found. Create one to get started.</div>
                )}
            </div>
        </div>
    );
}
