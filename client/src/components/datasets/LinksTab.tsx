import { useState, useEffect } from 'react';
import { api } from '../../config';
import { Plus, Trash, Edit, Save, X, ExternalLink, RefreshCw } from 'lucide-react';
import LanguageSwitcher, { type Language } from './LanguageSwitcher';

interface LinkConfig {
  _id: string;
  name: string;
  description?: string;
  content: {
    en?: { message: string; label?: string };
    si?: { message: string; label?: string };
    ta?: { message: string; label?: string };
  };
  isActive: boolean;
  metadata?: {
    url?: string;
    formId?: string;
  };
}

interface LinksTabProps {
  language: Language;
  onDataChange: () => void;
}

const linkTypes = [
  { id: 'registration', name: 'Registration Link', description: 'Link for user registration' },
  { id: 'payment', name: 'Payment Link', description: 'Link for payment processing' },
  { id: 'cv', name: 'CV Upload Link', description: 'Link for CV/document upload' },
  { id: 'support', name: 'Support Link', description: 'Link to support page' },
  { id: 'custom', name: 'Custom Link', description: 'Any other custom link' },
];

export default function LinksTab({ language, onDataChange }: LinksTabProps) {
  const [links, setLinks] = useState<LinkConfig[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkConfig | null>(null);
  const [editLanguage, setEditLanguage] = useState<Language>(language);
  const [loading, setLoading] = useState(true);

  const fetchLinks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/datasets?type=link');
      setLinks(Array.isArray(res.data) ? res.data : (res.data?.datasets || res.data?.data || []));
    } catch (error) {
      console.error('Failed to fetch links:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  const handleCreate = (type?: string) => {
    const newLink: LinkConfig = {
      _id: '',
      name: type || 'custom',
      description: linkTypes.find((t) => t.id === type)?.description || '',
      content: { en: { message: '' }, si: { message: '' }, ta: { message: '' } },
      isActive: true,
      metadata: { url: '' },
    };
    setEditingLink(newLink);
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleEdit = (link: LinkConfig) => {
    setEditingLink(link);
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this link?')) return;

    try {
      await api.delete(`/api/datasets/${id}`);
      fetchLinks();
      onDataChange();
    } catch (error) {
      console.error('Failed to delete link:', error);
      alert('Failed to delete link');
    }
  };

  const handleSave = async () => {
    if (!editingLink) return;

    try {
      const payload = {
        ...editingLink,
        type: 'link',
        key: `LINK_${editingLink.name.toUpperCase()}`,
      };

      if (editingLink._id) {
        await api.put(`/api/datasets/${editingLink._id}`, payload);
      } else {
        await api.post('/api/datasets', payload);
      }

      setIsEditing(false);
      setEditingLink(null);
      fetchLinks();
      onDataChange();
    } catch (error) {
      console.error('Failed to save link:', error);
      alert('Failed to save link configuration');
    }
  };

  const handleUpdateContent = (field: string, value: string) => {
    if (!editingLink) return;

    setEditingLink({
      ...editingLink,
      content: {
        ...editingLink.content,
        [editLanguage]: {
          ...(editingLink.content?.[editLanguage] || {}),
          [field]: value,
        },
      },
    });
  };

  const getTranslatedLanguages = (link: LinkConfig): Language[] => {
    const translated: Language[] = [];
    if (link.content?.en?.message) translated.push('en');
    if (link.content?.si?.message) translated.push('si');
    if (link.content?.ta?.message) translated.push('ta');
    return translated;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (isEditing && editingLink) {
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">
            {editingLink._id ? 'Edit Link' : 'New Link'}
          </h2>
          <button onClick={() => setIsEditing(false)} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Link Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Link Type</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingLink.name}
              onChange={(e) =>
                setEditingLink({
                  ...editingLink,
                  name: e.target.value,
                  description: linkTypes.find((t) => t.id === e.target.value)?.description || '',
                })
              }
            >
              {linkTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
            <input
              type="url"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingLink.metadata?.url || ''}
              onChange={(e) =>
                setEditingLink({
                  ...editingLink,
                  metadata: { ...editingLink.metadata, url: e.target.value },
                })
              }
              placeholder="https://example.com/form"
            />
          </div>

          {/* Language Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Edit message for:</span>
            <LanguageSwitcher
              currentLanguage={editLanguage}
              onLanguageChange={setEditLanguage}
              translatedLanguages={getTranslatedLanguages(editingLink)}
              size="sm"
            />
          </div>

          {/* Link Label */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Button Label ({editLanguage.toUpperCase()})
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingLink.content?.[editLanguage]?.label || ''}
              onChange={(e) => handleUpdateContent('label', e.target.value)}
              placeholder="e.g., Click here to register"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Message ({editLanguage.toUpperCase()})
            </label>
            <textarea
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingLink.content?.[editLanguage]?.message || ''}
              onChange={(e) => handleUpdateContent('message', e.target.value)}
              placeholder={`Enter the message to show when this link is requested in ${editLanguage.toUpperCase()}...`}
            />
            <p className="text-xs text-gray-500 mt-1">Use {'{URL}'} as a placeholder for the link URL</p>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="linkActive"
              checked={editingLink.isActive}
              onChange={(e) =>
                setEditingLink({ ...editingLink, isActive: e.target.checked })
              }
              className="h-4 w-4 text-blue-600 rounded"
            />
            <label htmlFor="linkActive" className="text-sm text-gray-700">
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
          Configure links for registration, payment, CV upload, etc. with localized messages.
        </p>
        <button
          onClick={() => handleCreate()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add Link
        </button>
      </div>

      {links.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <ExternalLink className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p>No links configured yet.</p>
          <p className="text-sm">Click "Add Link" to create your first link configuration.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map((link) => {
            const translated = getTranslatedLanguages(link);

            return (
              <div
                key={link._id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-800">{link.name}</h3>
                      {link.isActive ? (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                          Inactive
                        </span>
                      )}
                      {translated.map((lang) => (
                        <span
                          key={lang}
                          className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-xs rounded"
                        >
                          {lang.toUpperCase()}
                        </span>
                      ))}
                    </div>
                    {link.description && (
                      <p className="text-sm text-gray-500 mt-1">{link.description}</p>
                    )}
                    {link.metadata?.url && (
                      <a
                        href={link.metadata.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline flex items-center gap-1 mt-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {link.metadata.url.substring(0, 50)}...
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(link)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(link._id)}
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