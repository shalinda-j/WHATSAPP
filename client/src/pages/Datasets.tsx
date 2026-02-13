import { useState, useEffect } from 'react';
import api from '../utils/api';
import { Plus, Trash, Edit, Save, X } from 'lucide-react';

// Common preset scopes
// const PRESET_SCOPES = ['ALL', 'JCETI', 'GLOBAL', 'SG', 'ISRAEL', 'JAPAN'];

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

    const [availableScopes, setAvailableScopes] = useState<string[]>([]);
    const [isCreatingCompany, setIsCreatingCompany] = useState(false);
    const [newCompanyName, setNewCompanyName] = useState('');

    const fetchDatasets = async () => {
        const res = await api.get('/datasets');
        setDatasets(res.data);
    };

    const fetchCompanies = async () => {
        try {
            const res = await api.get('/companies');
            // Assuming res.data is [{ id: '...', name: '...' }]
            // We want to map this to scope names (UPPERCASE usually)
            // But config uses names like TechCorp. 
            // The existing preset scopes are UPPERCASE: 'JCETI', 'GLOBAL'.
            // The dynamic ones might be mixed case. Let's keep them as IDs or Names.
            // Let's use IDs as the scope value for consistency if possible, 
            // but the current system seems to use specific string keys.
            // Let's use the ID/Name from the API.
            const companies = res.data.map((c: any) => c.name); // Using Name as scope for now to match UI
            setAvailableScopes(companies);
        } catch (e) {
            console.error('Failed to fetch companies', e);
            // Fallback
            setAvailableScopes(['JCETI', 'GLOBAL', 'SG', 'ISRAEL', 'JAPAN']);
        }
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchDatasets();
        fetchCompanies();
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
        setIsEditing(true);
    };

    const handleCreate = () => {
        setFormData({ name: '', content: '', scope: availableScopes[0] || 'ALL', category: 'company', isActive: true });
        setEditingId(null);
        setIsEditing(true);
    };

    const handleCreateCompany = async () => {
        if (!newCompanyName) return;
        try {
            const res = await api.post('/companies', { name: newCompanyName });
            await fetchCompanies();
            setFormData({ ...formData, scope: res.data.name }); // Auto-select new company
            setIsCreatingCompany(false);
            setNewCompanyName('');
            alert('Company created successfully!');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert('Error creating company: ' + message);
        }
    };

    const handleSave = async () => {
        try {
            const dataToSave = {
                ...formData
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
                        <div className="flex gap-2">
                            <select
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                value={formData.scope}
                                onChange={e => setFormData({ ...formData, scope: e.target.value })}
                            >
                                <option value="ALL">ALL (Global Knowledge)</option>
                                {availableScopes.map(scope => (
                                    <option key={scope} value={scope}>{scope}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => setIsCreatingCompany(true)}
                                className="mt-1 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 whitespace-nowrap"
                            >
                                + New Company
                            </button>
                        </div>

                        {isCreatingCompany && (
                            <div className="mt-2 p-3 bg-gray-50 border rounded-md">
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">New Company Name</label>
                                <div className="flex gap-2">
                                    <input
                                        className="flex-1 px-3 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="e.g. Korea"
                                        value={newCompanyName}
                                        onChange={e => setNewCompanyName(e.target.value)}
                                    />
                                    <button
                                        onClick={handleCreateCompany}
                                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                    >
                                        Create
                                    </button>
                                    <button
                                        onClick={() => setIsCreatingCompany(false)}
                                        className="px-3 py-1 text-gray-500 hover:bg-gray-200 rounded"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
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

                                            // Using the api utility which handles baseURL and Authorization automatically
                                            const res = await api.post('/datasets/extract', formData, {
                                                headers: {
                                                    'Content-Type': 'multipart/form-data',
                                                },
                                            });

                                            const data = res.data;

                                            // Axios throws on non-2xx status, so we don't need manual check
                                            // if (!res.ok) throw new Error(data.message || 'Extraction failed');

                                            // Append extracted text
                                            setFormData(prev => ({
                                                ...prev,
                                                content: (prev.content ? prev.content + '\n\n' : '') + `[Extracted from ${file.name}]:\n${data.text}`
                                            }));
                                        } catch (err: any) {
                                            console.error(err);
                                            const backendError = err.response?.data?.error || err.message;
                                            alert('Failed to extract text: ' + backendError);
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
                            placeholder="Enter content (Text or JSON)..."
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                            value={typeof formData.content === 'object' ? JSON.stringify(formData.content, null, 2) : formData.content}
                            onChange={e => {
                                let val: any = e.target.value;
                                try {
                                    val = JSON.parse(val);
                                } catch {
                                    // keep as string if not valid JSON
                                }
                                setFormData({ ...formData, content: val });
                            }}
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
