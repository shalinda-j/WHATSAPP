import { useState, useEffect } from 'react';
import { api } from '../config';
import {
  UserCheck,
  Phone,
  Clock,
  Plus,
  Search,
  Filter,
  CheckCircle,
  AlertCircle,
  X,
  MessageSquare,
  Calendar,
  RefreshCw,
  ChevronDown,
  Star,
  Archive,
} from 'lucide-react';

interface FollowUpContact {
  _id: string;
  name: string;
  phone: string;
  whatsappId?: string;
  company?: string;
  status:
    | 'new'
    | 'contacted'
    | 'interested'
    | 'not_interested'
    | 'converted'
    | 'follow_up';
  tags?: string[];
  lastContact?: string;
  nextFollowUp?: string;
  notes?: string;
  priority: 'low' | 'medium' | 'high';
  source?: string;
  createdAt: string;
}

const STATUS_LABELS: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  new: { label: 'New', color: 'text-blue-700', bg: 'bg-blue-100' },
  contacted: {
    label: 'Contacted',
    color: 'text-purple-700',
    bg: 'bg-purple-100',
  },
  interested: {
    label: 'Interested',
    color: 'text-green-700',
    bg: 'bg-green-100',
  },
  not_interested: {
    label: 'Not Interested',
    color: 'text-red-700',
    bg: 'bg-red-100',
  },
  converted: {
    label: 'Converted',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
  },
  follow_up: {
    label: 'Follow Up',
    color: 'text-yellow-700',
    bg: 'bg-yellow-100',
  },
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-red-500',
  medium: 'text-yellow-500',
  low: 'text-gray-400',
};

export default function FollowUp() {
  const [contacts, setContacts] = useState<FollowUpContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [selectedContact, setSelectedContact] =
    useState<FollowUpContact | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingWA, setSendingWA] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  const [newContact, setNewContact] = useState<{
    name: string;
    phone: string;
    company: string;
    status: 'new';
    priority: 'low' | 'medium' | 'high';
    notes: string;
    nextFollowUp: string;
    source: string;
  }>({
    name: '',
    phone: '',
    company: '',
    status: 'new',
    priority: 'medium',
    notes: '',
    nextFollowUp: '',
    source: 'manual',
  });

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/crm/contacts?limit=200');
      const data = res.data?.contacts || res.data || [];
      setContacts(Array.isArray(data) ? data : []);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [message]);

  const filteredContacts = contacts.filter((c) => {
    const matchSearch =
      !searchQuery ||
      (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery) ||
      (c.company || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchPriority =
      priorityFilter === 'all' || c.priority === priorityFilter;
    return matchSearch && matchStatus && matchPriority;
  });

  const overdueFollowUps = contacts.filter((c) => {
    if (!c.nextFollowUp) return false;
    return new Date(c.nextFollowUp) < new Date() && c.status !== 'converted';
  });

  const todayFollowUps = contacts.filter((c) => {
    if (!c.nextFollowUp) return false;
    const d = new Date(c.nextFollowUp);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });

  const handleAddContact = async () => {
    if (!newContact.name || !newContact.phone) {
      setMessage({ type: 'error', text: 'Name and phone are required' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/crm/contacts', newContact);
      setMessage({ type: 'success', text: 'Contact added successfully' });
      setShowAdd(false);
      setNewContact({
        name: '',
        phone: '',
        company: '',
        status: 'new',
        priority: 'medium',
        notes: '',
        nextFollowUp: '',
        source: 'manual',
      });
      fetchContacts();
    } catch {
      setMessage({ type: 'error', text: 'Failed to add contact' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/api/crm/contacts/${id}`, { status });
      setContacts((prev) =>
        prev.map((c) =>
          c._id === id
            ? { ...c, status: status as FollowUpContact['status'] }
            : c,
        ),
      );
      if (selectedContact?._id === id)
        setSelectedContact((p) =>
          p ? { ...p, status: status as FollowUpContact['status'] } : null,
        );
      setMessage({ type: 'success', text: 'Status updated' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to update' });
    }
  };

  const handleScheduleFollowUp = async () => {
    if (!selectedContact || !followUpDate) return;
    try {
      await api.patch(`/api/crm/contacts/${selectedContact._id}`, {
        nextFollowUp: followUpDate,
        status: 'follow_up',
        notes: newNote
          ? `${
              selectedContact.notes || ''
            }\n[${new Date().toLocaleDateString()}] ${newNote}`.trim()
          : selectedContact.notes,
      });
      setContacts((prev) =>
        prev.map((c) =>
          c._id === selectedContact._id
            ? {
                ...c,
                nextFollowUp: followUpDate,
                status: 'follow_up',
                notes: newNote
                  ? `${c.notes || ''}\n${newNote}`.trim()
                  : c.notes,
              }
            : c,
        ),
      );
      setSelectedContact((p) =>
        p ? { ...p, nextFollowUp: followUpDate, status: 'follow_up' } : null,
      );
      setFollowUpDate('');
      setNewNote('');
      setMessage({ type: 'success', text: 'Follow-up scheduled!' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to schedule' });
    }
  };

  const handleSendWhatsApp = async (contact: FollowUpContact) => {
    if (!contact.whatsappId && !contact.phone) return;
    setSendingWA(contact._id);
    try {
      const msg = `Hi ${
        (contact.name || 'Friend').split(' ')[0]
      }! 👋 Just following up with you. How are you doing? Is there anything I can help you with?`;
      await api.post('/api/chat/send', {
        userId:
          contact.whatsappId ||
          `${contact.phone.replace('+', '')}@s.whatsapp.net`,
        message: msg,
      });
      setMessage({
        type: 'success',
        text: `Message sent to ${contact.name || 'Unknown'}`,
      });
      // Mark as contacted
      handleUpdateStatus(contact._id, 'contacted');
    } catch {
      setMessage({ type: 'error', text: 'Failed to send WhatsApp message' });
    } finally {
      setSendingWA(null);
    }
  };

  const stats = [
    {
      label: 'Total Contacts',
      value: contacts.length,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Overdue',
      value: overdueFollowUps.length,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      label: 'Due Today',
      value: todayFollowUps.length,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
    },
    {
      label: 'Converted',
      value: contacts.filter((c) => c.status === 'converted').length,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-8">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
              <UserCheck className="h-6 w-6 text-white" />
            </div>
            Follow-Up Manager
          </h1>
          <p className="text-gray-500 mt-1 ml-1">
            Track and manage client follow-ups and outreach
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchContacts}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium text-sm shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Contact
          </button>
        </div>
      </div>

      {/* Notification */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm border ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border-green-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {message.text}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`${s.bg} rounded-xl p-4 border border-white`}
          >
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {overdueFollowUps.length > 0 && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-semibold text-red-800">
              {overdueFollowUps.length} overdue follow-up
              {overdueFollowUps.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {overdueFollowUps.slice(0, 3).map((c) => (
              <button
                key={c._id}
                onClick={() => setSelectedContact(c)}
                className="text-xs bg-white border border-red-200 text-red-700 px-3 py-1 rounded-full hover:bg-red-50"
              >
                {c.name || 'Unknown'}
              </button>
            ))}
            {overdueFollowUps.length > 3 && (
              <span className="text-xs text-red-600">
                +{overdueFollowUps.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Contact List */}
        <div className="xl:col-span-2">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none"
              >
                <option value="all">All Status</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
            </div>
            <div className="relative">
              <Star className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none"
              >
                <option value="all">All Priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* List */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                <UserCheck className="h-12 w-12 mb-2 opacity-30" />
                <p className="text-sm">No contacts found</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredContacts.map((c) => {
                  const isOverdue =
                    c.nextFollowUp &&
                    new Date(c.nextFollowUp) < new Date() &&
                    c.status !== 'converted';
                  const statusInfo =
                    STATUS_LABELS[c.status] || STATUS_LABELS.new;

                  return (
                    <div
                      key={c._id}
                      className={`flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                        selectedContact?._id === c._id
                          ? 'bg-orange-50 border-l-4 border-orange-500'
                          : ''
                      }`}
                      onClick={() => setSelectedContact(c)}
                    >
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {(c.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {c.name || 'Unknown'}
                          </p>
                          <Star
                            className={`h-3 w-3 flex-shrink-0 ${
                              PRIORITY_COLORS[c.priority]
                            }`}
                            fill="currentColor"
                          />
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          {c.phone}
                          {c.company ? ` · ${c.company}` : ''}
                        </p>
                        {c.nextFollowUp && (
                          <p
                            className={`text-[10px] flex items-center gap-1 mt-0.5 ${
                              isOverdue
                                ? 'text-red-600 font-medium'
                                : 'text-gray-400'
                            }`}
                          >
                            <Clock className="h-2.5 w-2.5" />
                            {isOverdue ? 'Overdue: ' : 'Follow up: '}
                            {new Date(c.nextFollowUp).toLocaleDateString(
                              'en-US',
                              { month: 'short', day: 'numeric' },
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusInfo.bg} ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSendWhatsApp(c);
                          }}
                          disabled={sendingWA === c._id}
                          className="p-1 rounded-full bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                          title="Send WhatsApp"
                        >
                          {sendingWA === c._id ? (
                            <div className="h-3 w-3 border border-green-700 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <MessageSquare className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Detail Panel */}
        <div>
          {selectedContact ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 sticky top-4">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-900">
                  {selectedContact.name || 'Unknown'}
                </h3>
                <button
                  onClick={() => setSelectedContact(null)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {/* Info */}
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="h-4 w-4 text-gray-400" />{' '}
                    {selectedContact.phone}
                  </div>
                  {selectedContact.company && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Archive className="h-4 w-4 text-gray-400" />{' '}
                      {selectedContact.company}
                    </div>
                  )}
                  {selectedContact.nextFollowUp && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Calendar className="h-4 w-4 text-orange-400" />
                      Next:{' '}
                      {new Date(
                        selectedContact.nextFollowUp,
                      ).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  )}
                </div>

                {/* Status Update */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">
                    Status
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <button
                        key={k}
                        onClick={() =>
                          handleUpdateStatus(selectedContact._id, k)
                        }
                        className={`text-[11px] px-2 py-1.5 rounded-lg font-medium border transition-colors ${
                          selectedContact.status === k
                            ? `${v.bg} ${v.color} border-current`
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Schedule Follow-up */}
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs font-medium text-gray-700 mb-2">
                    Schedule Follow-up
                  </p>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 mb-2"
                  />
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add note..."
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none mb-2"
                  />
                  <button
                    onClick={handleScheduleFollowUp}
                    disabled={!followUpDate}
                    className="w-full py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                  >
                    Schedule Follow-up
                  </button>
                </div>

                {/* Send WhatsApp */}
                <div className="border-t border-gray-100 pt-3">
                  <button
                    onClick={() => handleSendWhatsApp(selectedContact)}
                    disabled={sendingWA === selectedContact._id}
                    className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <MessageSquare className="h-4 w-4" />
                    {sendingWA === selectedContact._id
                      ? 'Sending...'
                      : 'Send WhatsApp Follow-up'}
                  </button>
                </div>

                {/* Notes */}
                {selectedContact.notes && (
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs font-medium text-gray-500 mb-1.5">
                      Notes
                    </p>
                    <p className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap">
                      {selectedContact.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-400">
              <UserCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Select a contact</p>
              <p className="text-xs mt-1">
                to view details and manage follow-ups
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add Contact Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Add Contact</h3>
              <button
                onClick={() => setShowAdd(false)}
                className="p-1.5 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {[
                {
                  label: 'Name *',
                  field: 'name',
                  type: 'text',
                  placeholder: 'Full name',
                },
                {
                  label: 'Phone *',
                  field: 'phone',
                  type: 'tel',
                  placeholder: '+94771234567',
                },
                {
                  label: 'Company',
                  field: 'company',
                  type: 'text',
                  placeholder: 'Company name',
                },
              ].map(({ label, field, type, placeholder }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {label}
                  </label>
                  <input
                    type={type}
                    value={(newContact as Record<string, string>)[field]}
                    onChange={(e) =>
                      setNewContact((p) => ({ ...p, [field]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Priority
                  </label>
                  <select
                    value={newContact.priority}
                    onChange={(e) =>
                      setNewContact((p) => ({
                        ...p,
                        priority: e.target.value as 'high' | 'medium' | 'low',
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Next Follow-up
                  </label>
                  <input
                    type="date"
                    value={newContact.nextFollowUp}
                    onChange={(e) =>
                      setNewContact((p) => ({
                        ...p,
                        nextFollowUp: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={newContact.notes}
                  onChange={(e) =>
                    setNewContact((p) => ({ ...p, notes: e.target.value }))
                  }
                  placeholder="Initial notes..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none resize-none"
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAddContact}
                disabled={saving}
                className="flex-1 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Contact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
