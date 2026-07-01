import { useState, useEffect } from 'react';
import { api } from '../config';
import {
  Plus,
  Edit2,
  Trash2,
  Copy,
  Star,
  FileText,
  Users,
  Download,
  Smartphone,
  CheckCircle,
} from 'lucide-react';

interface FormField {
  id: string;
  type:
    | 'text'
    | 'number'
    | 'email'
    | 'phone'
    | 'select'
    | 'multiselect'
    | 'date'
    | 'textarea'
    | 'file';
  label: string;
  placeholder?: string;
  required: boolean;
  order: number;
  options?: string[];
  dataSource?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
}

interface FormTemplate {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  isDefault: boolean;
  triggerMode: 'manual' | 'auto' | 'both';
  triggerDelay: number;
  fields: FormField[];
  welcomeMessage?: string;
  completionMessage?: string;
  createdAt: string;
}

export default function FormBuilder() {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FormTemplate | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<'templates' | 'submissions'>(
    'templates',
  );

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [triggerMode, setTriggerMode] = useState<'manual' | 'auto' | 'both'>(
    'both',
  );
  const [triggerDelay, setTriggerDelay] = useState(10);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [completionMessage, setCompletionMessage] = useState('');

  const fetchTemplates = async () => {
    try {
      // Use shared axios instance so 401/403 routes through the global
      // auth-failure handler instead of silently dropping the response.
      const res = await api.get('/api/forms/templates');
      setTemplates(res.data);
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormFields([]);
    setTriggerMode('both');
    setTriggerDelay(10);
    setWelcomeMessage('');
    setCompletionMessage('');
    setEditingTemplate(null);
    setShowEditor(false);
  };

  const editTemplate = (template: FormTemplate) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormDescription(template.description || '');
    setFormFields(template.fields || []);
    setTriggerMode(template.triggerMode);
    setTriggerDelay(template.triggerDelay);
    setWelcomeMessage(template.welcomeMessage || '');
    setCompletionMessage(template.completionMessage || '');
    setShowEditor(true);
  };

  const addField = () => {
    const newField: FormField = {
      id: `field_${Date.now()}`,
      type: 'text',
      label: '',
      required: false,
      order: formFields.length,
    };
    setFormFields([...formFields, newField]);
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const updated = [...formFields];
    updated[index] = { ...updated[index], ...updates };
    setFormFields(updated);
  };

  const removeField = (index: number) => {
    setFormFields(formFields.filter((_, i) => i !== index));
  };

  const saveTemplate = async () => {
    if (!formName.trim()) {
      alert('Please enter a form name');
      return;
    }

    try {
      const url = editingTemplate
        ? `/api/forms/templates/${editingTemplate._id}`
        : '/api/forms/templates';
      const body = {
        name: formName,
        description: formDescription,
        fields: formFields,
        triggerMode,
        triggerDelay,
        welcomeMessage,
        completionMessage,
        isActive: true,
      };
      if (editingTemplate) {
        await api.put(url, body);
      } else {
        await api.post(url, body);
      }
      fetchTemplates();
      resetForm();
    } catch (error) {
      console.error('Error saving template:', error);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this form template?')) return;

    try {
      await api.delete(`/api/forms/templates/${id}`);
      fetchTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const duplicateTemplate = async (id: string) => {
    try {
      await api.post(`/api/forms/templates/${id}/duplicate`);
      fetchTemplates();
    } catch (error) {
      console.error('Error duplicating template:', error);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await api.post(`/api/forms/templates/${id}/set-default`);
      fetchTemplates();
    } catch (error) {
      console.error('Error setting default:', error);
    }
  };

  const fieldTypes = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'select', label: 'Dropdown' },
    { value: 'multiselect', label: 'Multi-Select' },
    { value: 'date', label: 'Date' },
    { value: 'textarea', label: 'Long Text' },
    { value: 'file', label: 'File Upload' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Form Builder</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('templates')}
            className={`px-4 py-2 rounded ${
              activeTab === 'templates'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200'
            }`}
          >
            <FileText className="inline mr-2 h-4 w-4" />
            Templates
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            className={`px-4 py-2 rounded ${
              activeTab === 'submissions'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200'
            }`}
          >
            <Users className="inline mr-2 h-4 w-4" />
            Submissions
          </button>
        </div>
      </div>

      {activeTab === 'templates' && !showEditor && (
        <>
          <div className="mb-4">
            <button
              onClick={() => setShowEditor(true)}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              <Plus className="inline mr-2 h-4 w-4" />
              Create New Form
            </button>
          </div>

          <div className="grid gap-4">
            {templates.map((template) => (
              <div
                key={template._id}
                className="bg-white rounded-lg shadow p-4"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{template.name}</h3>
                      {template.isDefault && (
                        <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">
                          <Star className="inline h-3 w-3 mr-1" />
                          Default
                        </span>
                      )}
                      {template.isActive ? (
                        <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                          Active
                        </span>
                      ) : (
                        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 text-sm mt-1">
                      {template.description}
                    </p>
                    <div className="flex gap-4 mt-2 text-sm text-gray-500">
                      <span>{template.fields?.length || 0} fields</span>
                      <span>Trigger: {template.triggerMode}</span>
                      {template.triggerMode !== 'manual' && (
                        <span>Delay: {template.triggerDelay}s</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!template.isDefault && (
                      <button
                        onClick={() => setDefault(template._id)}
                        className="text-yellow-600 hover:text-yellow-800"
                        title="Set as Default"
                      >
                        <Star className="h-5 w-5" />
                      </button>
                    )}
                    <button
                      onClick={() => editTemplate(template)}
                      className="text-blue-600 hover:text-blue-800"
                      title="Edit"
                    >
                      <Edit2 className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => duplicateTemplate(template._id)}
                      className="text-gray-600 hover:text-gray-800"
                      title="Duplicate"
                    >
                      <Copy className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => deleteTemplate(template._id)}
                      className="text-red-600 hover:text-red-800"
                      title="Delete"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {templates.length === 0 && (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No form templates yet</p>
                <button
                  onClick={() => setShowEditor(true)}
                  className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  Create Your First Form
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'templates' && showEditor && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">
                  {editingTemplate ? 'Edit Form' : 'Create New Form'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Live preview updates as you type
                </p>
              </div>
              <button
                onClick={resetForm}
                className="text-gray-500 hover:text-gray-700 px-3 py-1 border rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x">
            {/* LEFT: Editor */}
            <div className="p-4 space-y-5 overflow-y-auto max-h-[80vh]">
              {/* Basic Info */}
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Form Name *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                    placeholder="e.g., Job Registration Form"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Description
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-300 outline-none"
                    rows={2}
                    placeholder="Form description..."
                  />
                </div>
              </div>

              {/* Trigger Settings */}
              <div className="border-t pt-4">
                <h3 className="font-medium mb-3 text-gray-700">
                  ⚙️ Trigger Settings
                </h3>
                <div className="grid gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Trigger Mode
                    </label>
                    <select
                      value={triggerMode}
                      onChange={(e) =>
                        setTriggerMode(
                          e.target.value as 'manual' | 'auto' | 'both',
                        )
                      }
                      className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-300 outline-none"
                    >
                      <option value="manual">
                        Manual Only (!register command)
                      </option>
                      <option value="auto">
                        Auto (After conversation ends)
                      </option>
                      <option value="both">Both Manual & Auto</option>
                    </select>
                  </div>
                  {triggerMode !== 'manual' && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Auto-trigger delay (seconds)
                      </label>
                      <input
                        type="number"
                        value={triggerDelay}
                        onChange={(e) =>
                          setTriggerDelay(Number(e.target.value))
                        }
                        className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-300 outline-none"
                        min={5}
                        max={300}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Time to wait after last message before showing form
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="border-t pt-4">
                <h3 className="font-medium mb-3 text-gray-700">💬 Messages</h3>
                <div className="grid gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Welcome Message
                    </label>
                    <textarea
                      value={welcomeMessage}
                      onChange={(e) => setWelcomeMessage(e.target.value)}
                      className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-300 outline-none"
                      rows={2}
                      placeholder="Welcome! Let's get you registered..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Completion Message
                    </label>
                    <textarea
                      value={completionMessage}
                      onChange={(e) => setCompletionMessage(e.target.value)}
                      className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-300 outline-none"
                      rows={2}
                      placeholder="Thank you for registering! 🎉"
                    />
                  </div>
                </div>
              </div>

              {/* Fields */}
              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-gray-700">📋 Form Fields</h3>
                  <button
                    onClick={addField}
                    className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 flex items-center gap-1"
                  >
                    <Plus className="h-4 w-4" />
                    Add Field
                  </button>
                </div>

                <div className="space-y-3">
                  {formFields.map((field, index) => (
                    <div
                      key={field.id}
                      className="bg-gray-50 rounded-lg p-3 border border-gray-200"
                    >
                      <div className="grid grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            Type
                          </label>
                          <select
                            value={field.type}
                            onChange={(e) =>
                              updateField(index, {
                                type: e.target.value as FormField['type'],
                              })
                            }
                            className="w-full border rounded px-2 py-1 text-sm"
                          >
                            {fieldTypes.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-500 mb-1">
                            Label
                          </label>
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) =>
                              updateField(index, { label: e.target.value })
                            }
                            className="w-full border rounded px-2 py-1 text-sm"
                            placeholder="Field label"
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <label className="flex items-center gap-1 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) =>
                                updateField(index, {
                                  required: e.target.checked,
                                })
                              }
                              className="rounded"
                            />
                            Req.
                          </label>
                          <button
                            onClick={() => removeField(index)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {(field.type === 'select' ||
                        field.type === 'multiselect') && (
                        <div className="mt-2">
                          <label className="block text-xs text-gray-500 mb-1">
                            Options (comma-separated)
                          </label>
                          <input
                            type="text"
                            value={field.options?.join(', ') || ''}
                            onChange={(e) =>
                              updateField(index, {
                                options: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                            className="w-full border rounded px-2 py-1 text-sm"
                            placeholder="Option 1, Option 2, Option 3"
                          />
                          <div className="mt-2">
                            <label className="block text-xs text-gray-500 mb-1">
                              Data source (optional)
                            </label>
                            <select
                              value={field.dataSource || ''}
                              onChange={(e) =>
                                updateField(index, {
                                  dataSource: e.target.value,
                                })
                              }
                              className="w-full border rounded px-2 py-1 text-sm"
                            >
                              <option value="">Manual options (above)</option>
                              <option value="JOB_TYPES">Job types</option>
                              <option value="COUNTRIES">Countries</option>
                              <option value="EXPERIENCE_LEVELS">
                                Experience levels
                              </option>
                            </select>
                            <p className="mt-1 text-[11px] text-gray-400">
                              When set, options are loaded from your Datasets and
                              override the manual list above.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {formFields.length === 0 && (
                    <div className="text-center py-6 text-gray-400 border-2 border-dashed rounded-lg">
                      <Plus className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">
                        Click "Add Field" to start building your form
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="border-t pt-4 flex justify-end gap-3">
                <button
                  onClick={resetForm}
                  className="px-4 py-2 border rounded hover:bg-gray-50 text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={saveTemplate}
                  className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 font-medium flex items-center gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  {editingTemplate ? 'Update Form' : 'Create Form'}
                </button>
              </div>
            </div>

            {/* RIGHT: WhatsApp Live Preview */}
            <div className="p-4 bg-gray-50">
              <div className="flex items-center gap-2 mb-3">
                <Smartphone className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-600">
                  WhatsApp Preview
                </span>
                <span className="ml-auto text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                  Live
                </span>
              </div>

              {/* Phone frame */}
              <div className="mx-auto max-w-xs">
                <div
                  className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-200"
                  style={{ maxHeight: '520px' }}
                >
                  {/* WhatsApp header */}
                  <div className="bg-[#075E54] px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-300 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      AI
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">
                        360ai Bot
                      </p>
                      <p className="text-green-200 text-xs">online</p>
                    </div>
                  </div>

                  {/* Chat area */}
                  <div
                    className="overflow-y-auto p-3 space-y-2"
                    style={{
                      minHeight: '380px',
                      maxHeight: '400px',
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d1d5db' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
                      backgroundColor: '#ECE5DD',
                    }}
                  >
                    {/* Welcome message */}
                    {welcomeMessage ? (
                      <div className="flex justify-start">
                        <div className="bg-white rounded-lg rounded-tl-none p-2.5 max-w-[85%] shadow-sm">
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">
                            {welcomeMessage}
                          </p>
                          <p className="text-right text-xs text-gray-400 mt-1">
                            10:00 AM
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-start">
                        <div className="bg-white rounded-lg rounded-tl-none p-2.5 max-w-[85%] shadow-sm opacity-50">
                          <p className="text-sm text-gray-400 italic">
                            Welcome message will appear here...
                          </p>
                          <p className="text-right text-xs text-gray-300 mt-1">
                            10:00 AM
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Each field as a bot question + fake user reply */}
                    {formFields.map((field, idx) => {
                      const time = `10:0${idx + 1} AM`;
                      const placeholder =
                        field.type === 'email'
                          ? 'john@example.com'
                          : field.type === 'phone'
                            ? '+94 77 123 4567'
                            : field.type === 'date'
                              ? '1990-01-15'
                              : field.type === 'number'
                                ? '25'
                                : field.type === 'select' &&
                                    field.options?.length
                                  ? field.options[0]
                                  : field.type === 'textarea'
                                    ? 'I have 3 years of experience...'
                                    : 'Your answer here';

                      return (
                        <div key={field.id} className="space-y-1.5">
                          {/* Bot asks */}
                          <div className="flex justify-start">
                            <div className="bg-white rounded-lg rounded-tl-none p-2.5 max-w-[85%] shadow-sm">
                              <p className="text-xs text-[#075E54] font-semibold mb-0.5">
                                360ai Bot
                              </p>
                              <p className="text-sm text-gray-800">
                                {field.label || `Field ${idx + 1}`}
                                {field.required && (
                                  <span className="text-red-500 ml-1">*</span>
                                )}
                              </p>
                              {field.type === 'select' &&
                                field.options &&
                                field.options.length > 0 && (
                                  <div className="mt-1.5 space-y-1">
                                    {field.options
                                      .slice(0, 4)
                                      .map((opt, oi) => (
                                        <div
                                          key={oi}
                                          className="text-xs bg-gray-100 rounded px-2 py-1 text-gray-600"
                                        >
                                          {oi + 1}. {opt}
                                        </div>
                                      ))}
                                    {field.options.length > 4 && (
                                      <div className="text-xs text-gray-400">
                                        +{field.options.length - 4} more...
                                      </div>
                                    )}
                                  </div>
                                )}
                              <p className="text-right text-xs text-gray-400 mt-1">
                                {time} ✓
                              </p>
                            </div>
                          </div>
                          {/* Simulated user reply */}
                          <div className="flex justify-end">
                            <div className="bg-[#DCF8C6] rounded-lg rounded-tr-none p-2.5 max-w-[75%] shadow-sm">
                              <p className="text-sm text-gray-700 italic">
                                {placeholder}
                              </p>
                              <p className="text-right text-xs text-gray-400 mt-1">
                                {time} ✓✓
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Empty state */}
                    {formFields.length === 0 && !welcomeMessage && (
                      <div className="flex items-center justify-center h-32">
                        <div className="text-center text-gray-400">
                          <Smartphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
                          <p className="text-xs">Add fields to see preview</p>
                        </div>
                      </div>
                    )}

                    {/* Completion message */}
                    {completionMessage && (
                      <div className="flex justify-start">
                        <div className="bg-white rounded-lg rounded-tl-none p-2.5 max-w-[85%] shadow-sm border-l-4 border-green-400">
                          <p className="text-xs text-green-600 font-semibold mb-0.5">
                            ✅ Complete
                          </p>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">
                            {completionMessage}
                          </p>
                          <p className="text-right text-xs text-gray-400 mt-1">
                            10:{String(formFields.length + 1).padStart(2, '0')}{' '}
                            AM
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input bar (decorative) */}
                  <div className="bg-gray-100 px-3 py-2 flex items-center gap-2 border-t">
                    <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-xs text-gray-400">
                      Type a message...
                    </div>
                    <div className="w-7 h-7 rounded-full bg-[#075E54] flex items-center justify-center">
                      <span className="text-white text-xs">▶</span>
                    </div>
                  </div>
                </div>

                {/* Preview info */}
                <div className="mt-3 text-center">
                  <p className="text-xs text-gray-400">
                    {formFields.length} field
                    {formFields.length !== 1 ? 's' : ''} · {triggerMode} trigger
                    {triggerMode !== 'manual'
                      ? ` · ${triggerDelay}s delay`
                      : ''}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'submissions' && <FormSubmissions />}
    </div>
  );
}

interface FormSubmissionItem {
  _id: string;
  phoneNumber: string;
  formId: { name?: string } | string;
  status: string;
  submittedAt: string;
}

function FormSubmissions() {
  const [submissions, setSubmissions] = useState<FormSubmissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchSubmissions = async () => {
    try {
      // Use the shared api axios instance (baseURL from VITE_API_URL + the
      // 401/403 auth-failure interceptor), matching fetchTemplates. The old
      // raw fetch() ignored the baseURL (404s on cross-domain deploys), never
      // triggered the auth-failure redirect, and threw on a non-JSON error
      // body — leaving the page stuck on "No submissions yet".
      const url = statusFilter
        ? `/api/forms/submissions?status=${statusFilter}`
        : '/api/forms/submissions';
      const res = await api.get(url);
      setSubmissions(res.data.submissions || []);
    } catch (error) {
      console.error('Error fetching submissions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/api/forms/submissions/${id}/status`, { status });
      fetchSubmissions();
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Failed to update status. Please try again.');
    }
  };

  const exportCSV = async () => {
    // Use the shared api axios instance (baseURL + auth-failure interceptor)
    // and receive the CSV as a blob, then trigger the download via a temporary
    // anchor element. Raw fetch() ignored VITE_API_URL (404 on cross-domain
    // deploys) and bypassed the 401/403 auth-failure handler.
    try {
      const response = await api.get('/api/forms/submissions/export', {
        responseType: 'blob',
      });
      const blob = response.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `form-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Export failed. Please try again.');
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-2"
        >
          <option value="">All Statuses</option>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="contacted">Contacted</option>
          <option value="converted">Converted</option>
        </select>
        <button
          onClick={exportCSV}
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
        >
          <Download className="inline h-4 w-4 mr-2" />
          Export CSV
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Phone
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Form
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Submitted
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {submissions.map((sub) => (
              <tr key={sub._id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  {sub.phoneNumber}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {typeof sub.formId === 'object' && sub.formId?.name
                    ? sub.formId.name
                    : 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 text-xs rounded ${
                      sub.status === 'new'
                        ? 'bg-blue-100 text-blue-800'
                        : sub.status === 'reviewed'
                          ? 'bg-yellow-100 text-yellow-800'
                          : sub.status === 'contacted'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {sub.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(sub.submittedAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <select
                    value={sub.status}
                    onChange={(e) => updateStatus(sub._id, e.target.value)}
                    className="text-sm border rounded px-2 py-1"
                  >
                    <option value="new">New</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="contacted">Contacted</option>
                    <option value="converted">Converted</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {submissions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No submissions yet
          </div>
        )}
      </div>
    </>
  );
}
