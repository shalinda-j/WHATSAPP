import { useState, useEffect } from 'react';
import { api } from '../../config';
import { Plus, Trash, Edit, Save, X, FileText, Upload, RefreshCw } from 'lucide-react';
import LanguageSwitcher, { Language } from './LanguageSwitcher';

interface MegaTextItem {
  _id: string;
  name: string;
  description?: string;
  content: {
    en?: string;
    si?: string;
    ta?: string;
  };
  isActive: boolean;
  metadata?: {
    documentType?: 'knowledge' | 'template';
  };
}

interface MegaTextTabProps {
  language: Language;
  onDataChange: () => void;
}

const documentTypes = [
  { id: 'knowledge', label: 'Knowledge Document', description: 'Large document for AI knowledge (policies, manuals, guides)' },
  { id: 'template', label: 'Response Template', description: 'Pre-written response templates for common scenarios' },
];

export default function MegaTextTab({ language, onDataChange }: MegaTextTabProps) {
  const [items, setItems] = useState<MegaTextItem[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<MegaTextItem | null>(null);
  const [editLanguage, setEditLanguage] = useState<Language>(language);
  const [loading, setLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/datasets?type=megatext');
      setItems(res.data);
    } catch (error) {
      console.error('Failed to fetch mega text items:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleCreate = () => {
    const newItem: MegaTextItem = {
      _id: '',
      name: '',
      description: '',
      content: { en: '', si: '', ta: '' },
      isActive: true,
      metadata: { documentType: 'knowledge' },
    };
    setEditingItem(newItem);
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleEdit = (item: MegaTextItem) => {
    setEditingItem(item);
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
    if (!editingItem) return;

    try {
      const payload = {
        ...editingItem,
        type: 'megatext',
      };

      if (editingItem._id) {
        await api.put(`/api/datasets/${editingItem._id}`, payload);
      } else {
        await api.post('/api/datasets', payload);
      }

      setIsEditing(false);
      setEditingItem(null);
      fetchItems();
      onDataChange();
    } catch (error) {
      console.error('Failed to save:', error);
      alert('Failed to save item');
    }
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

      setEditingItem((prev) =>
        prev
          ? {
              ...prev,
              content: {
                ...prev.content,
                [editLanguage]: (prev.content?.[editLanguage] || '') + '\n\n' + res.data.text,
              },
            }
          : null
      );
    } catch (error) {
      console.error('Failed to extract text:', error);
      alert('Failed to extract text from file');
    } finally {
      setIsExtracting(false);
    }
  };

  const getTranslatedLanguages = (item: MegaTextItem): Language[] => {
    const translated: Language[] = [];
    if (item.content?.en) translated.push('en');
    if (item.content?.si) translated.push('si');
    if (item.content?.ta) translated.push('ta');
    return translated;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (isEditing && editingItem) {
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">
            {editingItem._id ? 'Edit' : 'New'} Mega Text
          </h2>
          <button onClick={() => setIsEditing(false)} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name & Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={editingItem.name}
                onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                placeholder="e.g., Company Policy Manual, FAQ Template"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={editingItem.metadata?.documentType || 'knowledge'}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    metadata: { ...editingItem.metadata, documentType: e.target.value as any },
                  })
                }
              >
                {documentTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingItem.description || ''}
              onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
              placeholder="Brief description"
            />
          </div>

          {/* Language Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Edit content for:</span>
            <LanguageSwitcher
              currentLanguage={editLanguage}
              onLanguageChange={setEditLanguage}
              translatedLanguages={getTranslatedLanguages(editingItem)}
              size="sm"
            />
          </div>

          {/* File Upload */}
          <div className="p-3 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
            {isExtracting ? (
              <p className="text-blue-600 text-sm animate-pulse text-center">Extracting text from file...</p>
            ) : (
              <label className="flex items-center justify-center gap-2 cursor-pointer text-sm text-gray-600 hover:text-blue-600">
                <Upload className="h-4 w-4" />
                <span>Upload document to extract text (PDF, Word, Text)</span>
                <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.doc,.docx,.txt" />
              </label>
            )}
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Content ({editLanguage.toUpperCase()})
            </label>
            <textarea
              rows={16}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              value={editingItem.content?.[editLanguage] || ''}
              onChange={(e) =>
                setEditingItem({
                  ...editingItem,
                  content: { ...editingItem.content, [editLanguage]: e.target.value },
                })
              }
              placeholder={`Enter large text content in ${editLanguage.toUpperCase()}...`}
            />
            <p className="text-xs text-gray-500 mt-1">
              {editingItem.metadata?.documentType === 'knowledge'
                ? 'This content will be used by AI for answering questions.'
                : 'This template can be used for generating responses.'}
            </p>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="megaTextActive"
              checked={editingItem.isActive}
              onChange={(e) => setEditingItem({ ...editingItem, isActive: e.target.checked })}
              className="h-4 w-4 text-blue-600 rounded"
            />
            <label htmlFor="megaTextActive" className="text-sm text-gray-700">
              Active
            </label>
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
      <div className="flex justify-between items-center mb-4">
        <p className="text-gray-600 text-sm">
          Store large documents for AI knowledge or pre-written response templates.
        </p>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add Document
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p>No documents yet.</p>
          <p className="text-sm">Click "Add Document" to upload or create content.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const translated = getTranslatedLanguages(item);
            const docType = documentTypes.find((t) => t.id === item.metadata?.documentType);
            const charCount = Object.values(item.content || {}).reduce(
              (sum, val) => sum + (typeof val === 'string' ? val.length : 0),
              0
            );

            return (
              <div
                key={item._id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-800">{item.name}</h3>
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                        {docType?.label || 'Document'}
                      </span>
                      {translated.map((lang) => (
                        <span
                          key={lang}
                          className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-xs rounded"
                        >
                          {lang.toUpperCase()}
                        </span>
                      ))}
                    </div>
                    {item.description && (
                      <p className="text-sm text-gray-500 mt-1">{item.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span>{charCount.toLocaleString()} characters</span>
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