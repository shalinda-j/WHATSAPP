import { useState, useEffect } from 'react';
import { api } from '../../config';
import { Plus, Trash, Edit, Save, X, Upload, Database } from 'lucide-react';
import LanguageSwitcher, { Language } from './LanguageSwitcher';

interface KnowledgeItem {
  _id: string;
  name: string;
  description?: string;
  content: {
    en?: string;
    si?: string;
    ta?: string;
  };
  scope: string;
  category: string;
  key?: string;
  isActive: boolean;
}

interface KnowledgeTabProps {
  language: Language;
  onDataChange: () => void;
}

const categories = [
  { value: 'company', label: 'Company Info' },
  { value: 'faq', label: 'FAQ' },
  { value: 'products', label: 'Products/Services' },
  { value: 'policies', label: 'Policies' },
  { value: 'general', label: 'General' },
];

export default function KnowledgeTab({ language, onDataChange }: KnowledgeTabProps) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<KnowledgeItem>>({
    name: '',
    description: '',
    content: { en: '', si: '', ta: '' },
    scope: 'ALL',
    category: 'general',
    isActive: true,
  });
  const [editLanguage, setEditLanguage] = useState<Language>(language);
  const [isExtracting, setIsExtracting] = useState(false);

  const fetchItems = async () => {
    try {
      const res = await api.get('/api/datasets?type=knowledge');
      setItems(res.data);
    } catch (error) {
      console.error('Failed to fetch knowledge items:', error);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleCreate = () => {
    setFormData({
      name: '',
      description: '',
      content: { en: '', si: '', ta: '' },
      scope: 'ALL',
      category: 'general',
      isActive: true,
    });
    setEditingId(null);
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleEdit = (item: KnowledgeItem) => {
    setFormData({
      ...item,
      content: item.content || { en: '', si: '', ta: '' },
    });
    setEditingId(item._id);
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;

    try {
      await api.delete(`/api/datasets/${id}`);
      fetchItems();
      onDataChange();
    } catch (error) {
      console.error('Failed to delete:', error);
      alert('Failed to delete item');
    }
  };

  const handleSave = async () => {
    try {
      const payload = {
        ...formData,
        type: 'knowledge',
      };

      if (editingId) {
        await api.put(`/api/datasets/${editingId}`, payload);
      } else {
        await api.post('/api/datasets', payload);
      }

      setIsEditing(false);
      fetchItems();
      onDataChange();
    } catch (error) {
      console.error('Failed to save:', error);
      alert('Failed to save item');
    }
  };

  const handleContentChange = (value: string) => {
    setFormData({
      ...formData,
      content: {
        ...(formData.content || {}),
        [editLanguage]: value,
      },
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const uploadForm = new FormData();
    uploadForm.append('file', file);

    try {
      setIsExtracting(true);
      const res = await api.post('/api/datasets/extract', uploadForm, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setFormData((prev) => ({
        ...prev,
        content: {
          ...(prev.content || {}),
          [editLanguage]: (prev.content?.[editLanguage] || '') + '\n\n' + res.data.text,
        },
      }));
    } catch (error) {
      console.error('Failed to extract text:', error);
      alert('Failed to extract text from file');
    } finally {
      setIsExtracting(false);
    }
  };

  const getTranslatedLanguages = (item: KnowledgeItem): Language[] => {
    const translated: Language[] = [];
    if (item.content?.en) translated.push('en');
    if (item.content?.si) translated.push('si');
    if (item.content?.ta) translated.push('ta');
    return translated;
  };

  if (isEditing) {
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">
            {editingId ? 'Edit Knowledge' : 'New Knowledge Entry'}
          </h2>
          <button onClick={() => setIsEditing(false)} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Company History, FAQ about Services"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this knowledge"
            />
          </div>

          {/* Scope & Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={formData.scope || 'ALL'}
                onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
                placeholder="e.g., ALL, COMPANY_NAME"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={formData.category || 'general'}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Content with Language Switcher */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">Content</label>
              <LanguageSwitcher
                currentLanguage={editLanguage}
                onLanguageChange={setEditLanguage}
                translatedLanguages={Object.keys(formData.content || {}).filter(
                  (k) => formData.content?.[k as Language]
                ) as Language[]}
                size="sm"
              />
            </div>

            {/* File Upload */}
            <div className="mb-3 p-3 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
              {isExtracting ? (
                <p className="text-blue-600 text-sm animate-pulse text-center">Extracting text...</p>
              ) : (
                <label className="flex items-center justify-center gap-2 cursor-pointer text-sm text-gray-600 hover:text-blue-600">
                  <Upload className="h-4 w-4" />
                  <span>Upload file to extract text</span>
                  <input type="file" className="hidden" onChange={handleFileUpload} />
                </label>
              )}
            </div>

            <textarea
              rows={12}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              value={formData.content?.[editLanguage] || ''}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={`Enter content in ${editLanguage.toUpperCase()}...`}
            />
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive !== false}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="h-4 w-4 text-blue-600 rounded"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">Active (include in AI knowledge)</label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Save className="h-4 w-4" /> Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <p className="text-gray-600 text-sm">
          Knowledge entries are used by the AI to answer user questions. Add company info, FAQs, policies, etc.
        </p>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add Knowledge
        </button>
      </div>

      {/* Items List */}
      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p>No knowledge entries yet.</p>
          <p className="text-sm">Click "Add Knowledge" to create your first entry.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const translated = getTranslatedLanguages(item);
            const hasCurrentLang = translated.includes(language);

            return (
              <div
                key={item._id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-800">{item.name}</h3>
                      {item.isActive ? (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Active</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">Inactive</span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-sm text-gray-500 mt-1">{item.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">{item.scope}</span>
                      <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded">{item.category}</span>
                      <div className="flex items-center gap-1">
                        {translated.map((lang) => (
                          <span key={lang} className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded">
                            {lang.toUpperCase()}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(item)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(item._id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}