import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../config';
import {
  ClipboardList,
  Trash,
  ExternalLink,
  RefreshCw,
  Plus,
} from 'lucide-react';

// Read-only listing of FormTemplate documents. Mirrors what /form-builder
// edits — the goal is just to make existing forms visible from the
// Datasets dashboard so the operator can see everything in one place.
interface FormField {
  id: string;
  type: string;
  label: string;
  required: boolean;
}

interface FormTemplateRow {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  isDefault: boolean;
  triggerMode: 'manual' | 'auto' | 'both';
  triggerDelay: number;
  fields: FormField[];
  createdAt: string;
  updatedAt: string;
}

interface FormsTabProps {
  onDataChange: () => void;
}

export default function FormsTab({ onDataChange }: FormsTabProps) {
  const [rows, setRows] = useState<FormTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/forms/templates');
      const arr = Array.isArray(res.data)
        ? res.data
        : (res.data?.templates ?? []);
      setRows(arr);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        'Delete this form template? Existing submissions are preserved.',
      )
    ) {
      return;
    }
    try {
      await api.delete(`/api/forms/templates/${id}`);
      await load();
      onDataChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete form');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <div>
          <p className="text-gray-600 text-sm">
            Dynamic forms collected by the bot during chats. Build and edit
            them in the Form Builder; this tab gives you a quick read-only
            overview from the dataset dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />{' '}
            Refresh
          </button>
          <Link
            to="/form-builder"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Open Form Builder
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <ClipboardList className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p>No form templates yet.</p>
          <p className="text-sm mt-1">
            Open the Form Builder to create your first dynamic form.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((t) => (
            <div
              key={t._id}
              className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-gray-800">{t.name}</h3>
                    {t.isActive ? (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                        Inactive
                      </span>
                    )}
                    {t.isDefault && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                        Default
                      </span>
                    )}
                    <span className="text-[10px] uppercase font-medium text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">
                      trigger: {t.triggerMode}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-sm text-gray-500 mt-1">
                      {t.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    <span>{t.fields?.length ?? 0} fields</span>
                    {t.triggerMode !== 'manual' && (
                      <span>delay: {t.triggerDelay}s</span>
                    )}
                    <span title={new Date(t.updatedAt).toLocaleString()}>
                      updated {new Date(t.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {t.fields && t.fields.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {t.fields.slice(0, 8).map((f) => (
                        <span
                          key={f.id}
                          className="text-[11px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded"
                          title={`type: ${f.type}${f.required ? ' · required' : ''}`}
                        >
                          {f.label}
                        </span>
                      ))}
                      {t.fields.length > 8 && (
                        <span className="text-[11px] text-gray-400 px-1">
                          +{t.fields.length - 8} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to="/form-builder"
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    title="Edit in Form Builder"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => handleDelete(t._id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
