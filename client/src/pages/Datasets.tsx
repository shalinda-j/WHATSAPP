import { useState, useEffect } from 'react';
import api from '../utils/api';
import { Plus, Trash, Edit, Save, X } from 'lucide-react';

interface Dataset {
    _id: string;
    name: string;
    content: string;
    scope: 'JCETI' | 'GLOBAL' | 'SG' | 'ALL';
    isActive: boolean;
}

export default function Datasets() {
    const [datasets, setDatasets] = useState<Dataset[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Dataset>>({ name: '', content: '', scope: 'ALL', isActive: true });

    useEffect(() => {
        fetchDatasets();
    }, []);

    const fetchDatasets = async () => {
        const res = await api.get('/datasets');
        setDatasets(res.data);
    };

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
        setFormData({ name: '', content: '', scope: 'ALL', isActive: true });
        setEditingId(null);
        setIsEditing(true);
    };

    const handleSave = async () => {
        try {
            if (editingId) {
                await api.put(`/datasets/${editingId}`, formData);
            } else {
                await api.post('/datasets', formData);
            }
            setIsEditing(false);
            fetchDatasets();
        } catch (err: any) {
            alert('Error saving: ' + err.message);
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
                        <label className="block text-sm font-medium text-gray-700">Scope</label>
                        <select
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            value={formData.scope}
                            // @ts-ignore
                            onChange={e => setFormData({ ...formData, scope: e.target.value })}
                        >
                            <option value="ALL">ALL</option>
                            <option value="JCETI">JCETI</option>
                            <option value="GLOBAL">GLOBAL</option>
                            <option value="SG">SG (Singapore)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Content</label>
                        <textarea
                            rows={15}
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
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scope</th>
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
                {datasets.length === 0 && (
                    <div className="p-8 text-center text-gray-500">No datasets found. Create one to get started.</div>
                )}
            </div>
        </div>
    );
}
