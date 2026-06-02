import { useState, useEffect } from 'react';
import { api } from '../../config';
import {
  Plus,
  Trash,
  Edit,
  Save,
  X,
  Upload,
  Database,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import LanguageSwitcher, { type Language } from './LanguageSwitcher';

// Hand-curated row coming from /api/datasets (Dataset collection).
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
  // Discriminator added client-side so the merged list can render two shapes.
  source: 'dataset';
}

// Auto-learned Q/A row coming from /api/knowledge (KnowledgeEntry collection).
// This was previously invisible in the Datasets page — every successful
// AI response is appended here by KnowledgeTrainingService.addKnowledge,
// plus anything imported via POST /api/knowledge/batch.
interface KnowledgeEntryItem {
  _id: string;
  question: string;
  answer: string;
  category: string;
  tags?: string[];
  source: 'knowledge_entry';
  origin?: 'manual' | 'conversation' | 'document' | 'import';
  confidence?: number;
  usageCount?: number;
  language?: 'en' | 'si' | 'ta' | 'hi' | 'all';
  isActive: boolean;
}

type AnyKnowledgeRow = KnowledgeItem | KnowledgeEntryItem;

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

export default function KnowledgeTab({
  language,
  onDataChange,
}: KnowledgeTabProps) {
  const [items, setItems] = useState<AnyKnowledgeRow[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which collection the row being edited belongs to. Determines whether
  // handleSave PUTs to /api/datasets/:id or /api/knowledge/:id — without
  // this, edits of auto-learned Q/A rows hit the wrong endpoint and 404.
  const [editingSource, setEditingSource] = useState<
    'dataset' | 'knowledge_entry'
  >('dataset');
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

  // Fetch BOTH stores in parallel and merge.
  //
  // Why: the original implementation only read /api/datasets, but the
  // KnowledgeTrainingService writes every auto-learned Q/A into the
  // separate KnowledgeEntry collection (POST /api/knowledge). All that
  // production data was previously invisible in the UI even though the
  // bot was using it to answer customers.
  const fetchItems = async () => {
    try {
      const [datasetsRes, knowledgeRes] = await Promise.allSettled([
        api.get('/api/datasets?type=knowledge'),
        api.get('/api/knowledge'),
      ]);

      const datasetRows: KnowledgeItem[] = [];
      if (datasetsRes.status === 'fulfilled') {
        const raw = datasetsRes.value.data;
        const arr = Array.isArray(raw) ? raw : raw?.datasets || raw?.data || [];
        for (const r of arr) {
          datasetRows.push({ ...r, source: 'dataset' });
        }
      } else {
        console.error('Failed to fetch /api/datasets:', datasetsRes.reason);
      }

      const entryRows: KnowledgeEntryItem[] = [];
      if (knowledgeRes.status === 'fulfilled') {
        const raw = knowledgeRes.value.data;
        const arr = Array.isArray(raw) ? raw : raw?.entries || [];
        for (const r of arr) {
          entryRows.push({
            _id: r._id,
            question: r.question,
            answer: r.answer,
            category: r.category ?? 'general',
            tags: r.tags ?? [],
            source: 'knowledge_entry',
            origin: r.source,
            confidence: r.confidence,
            usageCount: r.usageCount,
            language: r.language,
            isActive: r.isActive !== false,
          });
        }
      } else {
        // /api/knowledge may not exist on older deployments — log but don't
        // block, the Dataset rows still render.
        console.warn(
          'Failed to fetch /api/knowledge (auto-learned rows hidden):',
          knowledgeRes.reason,
        );
      }

      setItems([...datasetRows, ...entryRows]);
    } catch (error) {
      console.error('Failed to fetch knowledge items:', error);
    }
  };

  // Promote an auto-learned Q/A row into a hand-curated Dataset entry, so
  // the operator can edit/translate it like any other knowledge item.
  const handlePromote = async (entry: KnowledgeEntryItem) => {
    if (
      !window.confirm(
        'Copy this auto-learned Q/A into the curated knowledge base? You can then edit and translate it.',
      )
    ) {
      return;
    }
    try {
      await api.post('/api/datasets', {
        name: entry.question.slice(0, 120),
        description: 'Promoted from auto-learned Q/A',
        type: 'knowledge',
        content: {
          [entry.language && entry.language !== 'all' ? entry.language : 'en']:
            `Q: ${entry.question}\n\nA: ${entry.answer}`,
        },
        scope: 'ALL',
        category: entry.category || 'general',
        isActive: true,
      });
      fetchItems();
      onDataChange();
    } catch (err) {
      console.error('Failed to promote entry:', err);
      alert('Failed to promote entry');
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
    setEditingSource('dataset'); // new rows always go to /api/datasets
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleEdit = (row: AnyKnowledgeRow) => {
    // Translate KnowledgeEntry shape (question/answer) into the Dataset
    // form shape so the same modal can edit both. On save we map back.
    if (row.source === 'knowledge_entry') {
      setFormData({
        name: row.question,
        description: '',
        content: {
          [row.language && row.language !== 'all' ? row.language : 'en']:
            row.answer,
        } as KnowledgeItem['content'],
        scope: 'ALL',
        category: row.category ?? 'general',
        isActive: row.isActive,
      });
      setEditingSource('knowledge_entry');
    } else {
      setFormData({
        ...row,
        content: row.content || { en: '', si: '', ta: '' },
      });
      setEditingSource('dataset');
    }
    setEditingId(row._id);
    setEditLanguage(language);
    setIsEditing(true);
  };

  // Routes the delete to the correct collection. Dataset rows hit
  // /api/datasets/:id; KnowledgeEntry rows hit /api/knowledge/:id.
  const handleDelete = async (row: AnyKnowledgeRow) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;

    try {
      const endpoint =
        row.source === 'knowledge_entry'
          ? `/api/knowledge/${row._id}`
          : `/api/datasets/${row._id}`;
      await api.delete(endpoint);
      fetchItems();
      onDataChange();
    } catch (error) {
      console.error('Failed to delete:', error);
      alert('Failed to delete item');
    }
  };

  const handleSave = async () => {
    // Required-field guard: schema requires `name`. Without this guard the
    // server returns 400 and the old generic alert hid the reason.
    if (!formData.name || !formData.name.trim()) {
      alert('Name is required.');
      return;
    }

    try {
      if (editingId && editingSource === 'knowledge_entry') {
        // KnowledgeEntry has its own schema: question/answer/category.
        // Pick whichever language slot the user typed into.
        const content = formData.content || {};
        const answer =
          (typeof content.en === 'string' && content.en) ||
          (typeof content.si === 'string' && content.si) ||
          (typeof content.ta === 'string' && content.ta) ||
          '';
        await api.put(`/api/knowledge/${editingId}`, {
          question: formData.name,
          answer,
          category: formData.category ?? 'general',
          isActive: formData.isActive ?? true,
        });
      } else if (editingId) {
        await api.put(`/api/datasets/${editingId}`, {
          ...formData,
          type: 'knowledge',
        });
      } else {
        // New rows always land in Dataset — auto-learned entries are
        // only created server-side by KnowledgeTrainingService.
        await api.post('/api/datasets', {
          ...formData,
          type: 'knowledge',
        });
      }

      setIsEditing(false);
      fetchItems();
      onDataChange();
    } catch (error: unknown) {
      // Surface the actual server error instead of a generic message so
      // operators can see WHY the save failed (validation, duplicate key,
      // auth, etc.).
      const err = error as {
        response?: { data?: { error?: string; message?: string } };
        message?: string;
      };
      const serverMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Unknown error';
      console.error('Failed to save:', error);
      alert(`Failed to save: ${serverMsg}`);
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
          [editLanguage]:
            (prev.content?.[editLanguage] || '') + '\n\n' + res.data.text,
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

  const datasetCount = items.filter((i) => i.source === 'dataset').length;
  const entryCount = items.filter((i) => i.source === 'knowledge_entry').length;

  if (isEditing) {
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">
            {editingId ? 'Edit Knowledge' : 'New Knowledge Entry'}
          </h2>
          <button
            onClick={() => setIsEditing(false)}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={formData.name || ''}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="e.g., Company History, FAQ about Services"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={formData.description || ''}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Brief description of this knowledge"
            />
          </div>

          {/* Scope & Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Scope
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={formData.scope || 'ALL'}
                onChange={(e) =>
                  setFormData({ ...formData, scope: e.target.value })
                }
                placeholder="e.g., ALL, COMPANY_NAME"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={formData.category || 'general'}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Content with Language Switcher */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Content
              </label>
              <LanguageSwitcher
                currentLanguage={editLanguage}
                onLanguageChange={setEditLanguage}
                translatedLanguages={
                  Object.keys(formData.content || {}).filter(
                    (k) => formData.content?.[k as Language],
                  ) as Language[]
                }
                size="sm"
              />
            </div>

            {/* File Upload */}
            <div className="mb-3 p-3 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
              {isExtracting ? (
                <p className="text-blue-600 text-sm animate-pulse text-center">
                  Extracting text...
                </p>
              ) : (
                <label className="flex items-center justify-center gap-2 cursor-pointer text-sm text-gray-600 hover:text-blue-600">
                  <Upload className="h-4 w-4" />
                  <span>Upload file to extract text</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
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
              onChange={(e) =>
                setFormData({ ...formData, isActive: e.target.checked })
              }
              className="h-4 w-4 text-blue-600 rounded"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">
              Active (include in AI knowledge)
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
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <p className="text-gray-600 text-sm">
            Knowledge entries are used by the AI to answer user questions. Add
            company info, FAQs, policies, etc.
          </p>
          {entryCount > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              Showing {datasetCount} curated entries + {entryCount} auto-learned
              Q/A from past conversations.
            </p>
          )}
        </div>
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
          <p className="text-sm">
            Click "Add Knowledge" to create your first entry.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((row) => {
            if (row.source === 'knowledge_entry') {
              // Auto-learned Q/A row — read-only display + Promote + Delete.
              return (
                <div
                  key={row._id}
                  className="border border-amber-200 bg-amber-50/30 rounded-lg p-4 hover:border-amber-300 transition"
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full">
                          <Sparkles className="h-3 w-3" /> Auto-learned
                        </span>
                        {row.origin && (
                          <span className="text-[10px] uppercase font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                            {row.origin}
                          </span>
                        )}
                        {row.isActive ? (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                            Inactive
                          </span>
                        )}
                      </div>
                      <h3 className="font-medium text-gray-800 mt-2 line-clamp-2">
                        Q: {row.question}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-3 whitespace-pre-wrap">
                        A: {row.answer}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                        <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded">
                          {row.category}
                        </span>
                        {row.language && (
                          <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded">
                            {row.language.toUpperCase()}
                          </span>
                        )}
                        {typeof row.usageCount === 'number' && (
                          <span title="Times this entry was matched">
                            used {row.usageCount}×
                          </span>
                        )}
                        {typeof row.confidence === 'number' && (
                          <span title="AI confidence">
                            conf {(row.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                        {row.tags && row.tags.length > 0 && (
                          <span className="text-gray-400">
                            tags: {row.tags.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handlePromote(row)}
                        title="Copy into curated knowledge base (then editable)"
                        className="p-2 text-gray-400 hover:text-amber-700 hover:bg-amber-100 rounded"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(row)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            // Curated Dataset row — full edit form available.
            const translated = getTranslatedLanguages(row);

            return (
              <div
                key={row._id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-800">{row.name}</h3>
                      {row.isActive ? (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                          Inactive
                        </span>
                      )}
                    </div>
                    {row.description && (
                      <p className="text-sm text-gray-500 mt-1">
                        {row.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">
                        {row.scope}
                      </span>
                      <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded">
                        {row.category}
                      </span>
                      <div className="flex items-center gap-1">
                        {translated.map((lang) => (
                          <span
                            key={lang}
                            className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded"
                          >
                            {lang.toUpperCase()}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(row)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(row)}
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
