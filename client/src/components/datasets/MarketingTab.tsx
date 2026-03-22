import { useState, useEffect } from 'react';
import { api } from '../../config';
import { Plus, Trash, Edit, Save, X, Send, Calendar, Users, BarChart3, RefreshCw } from 'lucide-react';
import LanguageSwitcher, { type Language } from './LanguageSwitcher';

interface MarketingTemplate {
  _id: string;
  name: string;
  description?: string;
  content: {
    en?: { subject?: string; body: string };
    si?: { subject?: string; body: string };
    ta?: { subject?: string; body: string };
  };
  isActive: boolean;
  metadata?: {
    targetAudience?: string[];
    schedule?: string;
    type?: 'template' | 'sequence' | 'campaign';
  };
}

interface MarketingTabProps {
  language: Language;
  onDataChange: () => void;
}

const marketingTypes = [
  { id: 'template', label: 'Message Template', description: 'Pre-written message for campaigns' },
  { id: 'sequence', label: 'Follow-up Sequence', description: 'Automated follow-up messages' },
  { id: 'campaign', label: 'Campaign', description: 'Scheduled marketing campaign' },
];

export default function MarketingTab({ language, onDataChange }: MarketingTabProps) {
  const [templates, setTemplates] = useState<MarketingTemplate[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MarketingTemplate | null>(null);
  const [editLanguage, setEditLanguage] = useState<Language>(language);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'templates' | 'analytics'>('templates');

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/datasets?type=marketing');
      setTemplates(res.data);
    } catch (error) {
      console.error('Failed to fetch marketing templates:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleCreate = () => {
    const newTemplate: MarketingTemplate = {
      _id: '',
      name: '',
      description: '',
      content: { en: { body: '' }, si: { body: '' }, ta: { body: '' } },
      isActive: true,
      metadata: { type: 'template', targetAudience: [] },
    };
    setEditingTemplate(newTemplate);
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleEdit = (template: MarketingTemplate) => {
    setEditingTemplate(template);
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this template?')) return;

    try {
      await api.delete(`/api/datasets/${id}`);
      fetchTemplates();
      onDataChange();
    } catch (error) {
      console.error('Failed to delete template:', error);
      alert('Failed to delete template');
    }
  };

  const handleSave = async () => {
    if (!editingTemplate) return;

    try {
      const payload = {
        ...editingTemplate,
        type: 'marketing',
      };

      if (editingTemplate._id) {
        await api.put(`/api/datasets/${editingTemplate._id}`, payload);
      } else {
        await api.post('/api/datasets', payload);
      }

      setIsEditing(false);
      setEditingTemplate(null);
      fetchTemplates();
      onDataChange();
    } catch (error) {
      console.error('Failed to save template:', error);
      alert('Failed to save template');
    }
  };

  const handleUpdateContent = (field: string, value: string) => {
    if (!editingTemplate) return;

    setEditingTemplate({
      ...editingTemplate,
      content: {
        ...editingTemplate.content,
        [editLanguage]: {
          ...(editingTemplate.content?.[editLanguage] || {}),
          [field]: value,
        },
      },
    });
  };

  const getTranslatedLanguages = (template: MarketingTemplate): Language[] => {
    const translated: Language[] = [];
    if (template.content?.en?.body) translated.push('en');
    if (template.content?.si?.body) translated.push('si');
    if (template.content?.ta?.body) translated.push('ta');
    return translated;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (isEditing && editingTemplate) {
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">
            {editingTemplate._id ? 'Edit Marketing Content' : 'New Marketing Content'}
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
                value={editingTemplate.name}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                placeholder="e.g., Welcome Message, Holiday Promo"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={editingTemplate.metadata?.type || 'template'}
                onChange={(e) =>
                  setEditingTemplate({
                    ...editingTemplate,
                    metadata: { ...editingTemplate.metadata, type: e.target.value as any },
                  })
                }
              >
                {marketingTypes.map((type) => (
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
              value={editingTemplate.description || ''}
              onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
              placeholder="Brief description of this template"
            />
          </div>

          {/* Language Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Edit content for:</span>
            <LanguageSwitcher
              currentLanguage={editLanguage}
              onLanguageChange={setEditLanguage}
              translatedLanguages={getTranslatedLanguages(editingTemplate)}
              size="sm"
            />
          </div>

          {/* Subject (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject/Title ({editLanguage.toUpperCase()})
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingTemplate.content?.[editLanguage]?.subject || ''}
              onChange={(e) => handleUpdateContent('subject', e.target.value)}
              placeholder="Optional subject or title"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Message Body ({editLanguage.toUpperCase()})
            </label>
            <textarea
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingTemplate.content?.[editLanguage]?.body || ''}
              onChange={(e) => handleUpdateContent('body', e.target.value)}
              placeholder={`Enter the marketing message in ${editLanguage.toUpperCase()}...`}
            />
            <p className="text-xs text-gray-500 mt-1">
              Use placeholders like {'{name}'}, {'{company}'} for personalization
            </p>
          </div>

          {/* Target Audience */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingTemplate.metadata?.targetAudience?.join(', ') || ''}
              onChange={(e) =>
                setEditingTemplate({
                  ...editingTemplate,
                  metadata: {
                    ...editingTemplate.metadata,
                    targetAudience: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                  },
                })
              }
              placeholder="e.g., leads, customers, prospects (comma-separated)"
            />
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="templateActive"
              checked={editingTemplate.isActive}
              onChange={(e) => setEditingTemplate({ ...editingTemplate, isActive: e.target.checked })}
              className="h-4 w-4 text-blue-600 rounded"
            />
            <label htmlFor="templateActive" className="text-sm text-gray-700">
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
      {/* Sub-tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setActiveSubTab('templates')}
          className={`px-4 py-2 font-medium text-sm border-b-2 ${
            activeSubTab === 'templates'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500'
          }`}
        >
          <Send className="h-4 w-4 inline mr-2" />
          Templates & Sequences
        </button>
        <button
          onClick={() => setActiveSubTab('analytics')}
          className={`px-4 py-2 font-medium text-sm border-b-2 ${
            activeSubTab === 'analytics'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500'
          }`}
        >
          <BarChart3 className="h-4 w-4 inline mr-2" />
          Analytics
        </button>
      </div>

      {activeSubTab === 'analytics' ? (
        <div className="text-center py-12 text-gray-500">
          <BarChart3 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p>Marketing analytics coming soon</p>
          <p className="text-sm">Track campaign performance, open rates, and conversions.</p>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-center mb-4">
            <p className="text-gray-600 text-sm">
              Create marketing templates, follow-up sequences, and campaigns.
            </p>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" /> Create Template
            </button>
          </div>

          {templates.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Send className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No marketing templates yet.</p>
              <p className="text-sm">Click "Create Template" to get started.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {templates.map((template) => {
                const translated = getTranslatedLanguages(template);
                const typeInfo = marketingTypes.find((t) => t.id === template.metadata?.type);

                return (
                  <div
                    key={template._id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-800">{template.name}</h3>
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                            {typeInfo?.label || 'Template'}
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
                        {template.description && (
                          <p className="text-sm text-gray-500 mt-1">{template.description}</p>
                        )}
                        {template.metadata?.targetAudience && template.metadata.targetAudience.length > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            <Users className="h-3 w-3 text-gray-400" />
                            <span className="text-xs text-gray-500">
                              {template.metadata.targetAudience.join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(template)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(template._id)}
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
        </>
      )}
    </div>
  );
}