import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Copy, Star, Settings, FileText, Users, Download, Eye, ToggleLeft, ToggleRight } from 'lucide-react';

interface FormField {
  id: string;
  type: 'text' | 'number' | 'email' | 'phone' | 'select' | 'multiselect' | 'date' | 'textarea' | 'file';
  label: string;
  placeholder?: string;
  required: boolean;
  order: number;
  options?: string[];
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
  const [editingTemplate, setEditingTemplate] = useState<FormTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<'templates' | 'submissions'>('templates');

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [triggerMode, setTriggerMode] = useState<'manual' | 'auto' | 'both'>('both');
  const [triggerDelay, setTriggerDelay] = useState(10);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [completionMessage, setCompletionMessage] = useState('');

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/forms/templates', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const data = await res.json();
      setTemplates(data);
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoading(false);
    }
  };

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
    setFormFields(template.fields);
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
      const method = editingTemplate ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          name: formName,
          description: formDescription,
          fields: formFields,
          triggerMode,
          triggerDelay,
          welcomeMessage,
          completionMessage,
          isActive: true,
        }),
      });

      if (res.ok) {
        fetchTemplates();
        resetForm();
      }
    } catch (error) {
      console.error('Error saving template:', error);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this form template?')) return;

    try {
      await fetch(`/api/forms/templates/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      fetchTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const duplicateTemplate = async (id: string) => {
    try {
      await fetch(`/api/forms/templates/${id}/duplicate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      fetchTemplates();
    } catch (error) {
      console.error('Error duplicating template:', error);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await fetch(`/api/forms/templates/${id}/set-default`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
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
            className={`px-4 py-2 rounded ${activeTab === 'templates' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            <FileText className="inline mr-2 h-4 w-4" />
            Templates
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            className={`px-4 py-2 rounded ${activeTab === 'submissions' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
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
              <div key={template._id} className="bg-white rounded-lg shadow p-4">
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
                        <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Active</span>
                      ) : (
                        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded">Inactive</span>
                      )}
                    </div>
                    <p className="text-gray-600 text-sm mt-1">{template.description}</p>
                    <div className="flex gap-4 mt-2 text-sm text-gray-500">
                      <span>{template.fields.length} fields</span>
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
          <div className="p-4 border-b">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                {editingTemplate ? 'Edit Form' : 'Create New Form'}
              </h2>
              <button
                onClick={resetForm}
                className="text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="p-4 space-y-6">
            {/* Basic Info */}
            <div className="grid gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Form Name *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., Job Registration Form"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                  placeholder="Form description..."
                />
              </div>
            </div>

            {/* Trigger Settings */}
            <div className="border-t pt-4">
              <h3 className="font-medium mb-3">Trigger Settings</h3>
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Trigger Mode</label>
                  <select
                    value={triggerMode}
                    onChange={(e) => setTriggerMode(e.target.value as any)}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="manual">Manual Only (!register command)</option>
                    <option value="auto">Auto (After conversation ends)</option>
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
                      onChange={(e) => setTriggerDelay(Number(e.target.value))}
                      className="w-full border rounded px-3 py-2"
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
              <h3 className="font-medium mb-3">Messages</h3>
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Welcome Message</label>
                  <textarea
                    value={welcomeMessage}
                    onChange={(e) => setWelcomeMessage(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    rows={2}
                    placeholder="Welcome! Let's get you registered..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Completion Message</label>
                  <textarea
                    value={completionMessage}
                    onChange={(e) => setCompletionMessage(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    rows={2}
                    placeholder="Thank you for registering!"
                  />
                </div>
              </div>
            </div>

            {/* Fields */}
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium">Form Fields</h3>
                <button
                  onClick={addField}
                  className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600"
                >
                  <Plus className="inline h-4 w-4 mr-1" />
                  Add Field
                </button>
              </div>

              <div className="space-y-3">
                {formFields.map((field, index) => (
                  <div key={field.id} className="bg-gray-50 rounded p-3">
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Type</label>
                        <select
                          value={field.type}
                          onChange={(e) => updateField(index, { type: e.target.value as any })}
                          className="w-full border rounded px-2 py-1 text-sm"
                        >
                          {fieldTypes.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-500 mb-1">Label</label>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                          className="w-full border rounded px-2 py-1 text-sm"
                          placeholder="Field label"
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <label className="flex items-center gap-1 text-sm">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) => updateField(index, { required: e.target.checked })}
                          />
                          Required
                        </label>
                        <button
                          onClick={() => removeField(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {(field.type === 'select' || field.type === 'multiselect') && (
                      <div className="mt-2">
                        <label className="block text-xs text-gray-500 mb-1">Options (comma-separated)</label>
                        <input
                          type="text"
                          value={field.options?.join(', ') || ''}
                          onChange={(e) => updateField(index, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                          className="w-full border rounded px-2 py-1 text-sm"
                          placeholder="Option 1, Option 2, Option 3"
                        />
                      </div>
                    )}
                  </div>
                ))}

                {formFields.length === 0 && (
                  <p className="text-gray-500 text-center py-4">No fields added yet</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="border-t pt-4 flex justify-end gap-3">
              <button
                onClick={resetForm}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveTemplate}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              >
                {editingTemplate ? 'Update Form' : 'Create Form'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'submissions' && <FormSubmissions />}
    </div>
  );
}

function FormSubmissions() {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    fetchSubmissions();
  }, [statusFilter]);

  const fetchSubmissions = async () => {
    try {
      const url = statusFilter
        ? `/api/forms/submissions?status=${statusFilter}`
        : '/api/forms/submissions';
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const data = await res.json();
      setSubmissions(data.submissions || []);
    } catch (error) {
      console.error('Error fetching submissions:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/forms/submissions/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ status }),
      });
      fetchSubmissions();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const exportCSV = async () => {
    window.open('/api/forms/submissions/export', '_blank');
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
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Form</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {submissions.map((sub) => (
              <tr key={sub._id}>
                <td className="px-6 py-4 whitespace-nowrap">{sub.phoneNumber}</td>
                <td className="px-6 py-4 whitespace-nowrap">{(sub.formId as any)?.name || 'N/A'}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs rounded ${
                    sub.status === 'new' ? 'bg-blue-100 text-blue-800' :
                    sub.status === 'reviewed' ? 'bg-yellow-100 text-yellow-800' :
                    sub.status === 'contacted' ? 'bg-purple-100 text-purple-800' :
                    'bg-green-100 text-green-800'
                  }`}>
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