import { useState, useEffect } from 'react';
import { api } from '../config';
import {
  Search, Download, Upload,
  Eye, Trash2, X, FileText, CheckCircle,
  XCircle, Clock, ChevronLeft, ChevronRight,
  MessageSquare, UserPlus, Filter, RotateCcw,
  Phone, Mail, MapPin, Briefcase, AlertCircle
} from 'lucide-react';

interface Lead {
  _id: string;
  fullName: string;
  phoneNumber: string;
  address: string;
  email?: string;
  jobVacancyType: string;
  qualifications: {
    documentType: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    extractedText?: string;
    uploadedAt: Date;
  }[];
  status: 'new' | 'reviewed' | 'contacted' | 'accepted' | 'rejected';
  notes?: string;
  registeredAt: Date;
}

interface LeadStats {
  total: number;
  totalLeads?: number;
  weekLeads: number;
  byStatus: Record<string, number>;
  byJobType: Record<string, number>;
}

interface LeadMessage {
  id: string;
  content: string;
  type: string;
  timestamp: string;
  sender: string;
  role?: 'user' | 'assistant' | 'system';
}

const statusConfig = {
  new: { label: 'New', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: Clock },
  reviewed: { label: 'Reviewed', color: 'bg-yellow-50 text-yellow-700 border-yellow-200', icon: Eye },
  contacted: { label: 'Contacted', color: 'bg-purple-50 text-purple-700 border-purple-200', icon: Phone },
  accepted: { label: 'Accepted', color: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-50 text-red-700 border-red-200', icon: XCircle }
};

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const showNotify = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleExportCSV = async () => {
    try {
      const res = await api.get('/api/leads/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `leads-export-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showNotify('Export downloaded successfully', 'success');
    } catch {
      showNotify('Failed to export CSV', 'error');
    }
  };

  const fetchMessages = async (leadId: string) => {
    setLoadingMessages(true);
    try {
      const res = await api.get(`/api/leads/${leadId}/messages`);
      setMessages(res.data.messages || []);
    } catch (error) {
      console.error('Failed to fetch messages', error);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (showModal && selectedLead) {
      fetchMessages(selectedLead._id);
    } else {
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, selectedLead?._id]);

  const fetchLeads = async () => {
    try {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', '20');
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      if (jobFilter) params.append('jobVacancyType', jobFilter);

      const res = await api.get(`/api/leads?${params}`);
      setLeads(res.data.leads);
      setTotalPages(res.data.totalPages);
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get('/api/leads/stats');
      setStats(res.data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchJobTypes = async () => {
    try {
      const res = await api.get('/api/leads/job-types');
      setJobTypes(res.data);
    } catch (err) {
      console.error('Failed to fetch job types:', err);
    }
  };

  useEffect(() => {
    fetchLeads();
    fetchStats();
    fetchJobTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, statusFilter, jobFilter]);

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      await api.put(`/api/leads/${leadId}`, { status: newStatus });
      fetchLeads();
      fetchStats();
      showNotify('Status updated', 'success');
    } catch {
      showNotify('Failed to update status', 'error');
    }
  };

  const handleDelete = async (leadId: string) => {
    if (!confirm('Are you sure you want to delete this lead?')) return;
    try {
      await api.delete(`/api/leads/${leadId}`);
      if (showModal && selectedLead?._id === leadId) {
        setShowModal(false);
        setSelectedLead(null);
      }
      fetchLeads();
      fetchStats();
      showNotify('Lead deleted successfully', 'success');
    } catch {
      showNotify('Failed to delete lead', 'error');
    }
  };

  const handleFileUpload = async (leadId: string, file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', 'qualification');

    try {
      const res = await api.post(`/api/leads/${leadId}/qualifications`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (selectedLead && selectedLead._id === leadId) {
        setSelectedLead({ ...selectedLead, qualifications: res.data.qualifications });
      }
      fetchLeads();
      showNotify('File uploaded successfully', 'success');
    } catch {
      showNotify('Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Leads & Registrations</h1>
          <p className="text-gray-500 font-medium mt-1">Manage and track your incoming job applications</p>
        </div>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:-translate-y-0.5 transition active:translate-y-0"
        >
          <Download className="h-5 w-5" /> Export to CSV
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-5 rounded-2xl shadow-lg shadow-indigo-200 text-white transform transition hover:scale-[1.02]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-indigo-100 text-sm font-medium">Total Leads</p>
              <p className="text-3xl font-extrabold mt-1">{stats?.totalLeads || stats?.total || 0}</p>
            </div>
            <div className="bg-white/20 p-2 rounded-xl">
              <UserPlus className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        {Object.entries(statusConfig).map(([key, config]) => {
          const Icon = config.icon;
          const count = stats?.byStatus?.[key] || 0;
          return (
            <div
              key={key}
              className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 transition hover:shadow-md hover:border-indigo-100"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-gray-500 text-sm font-medium">{config.label}</p>
                  <p className="text-2xl font-bold mt-1 text-gray-900">{count}</p>
                </div>
                <div className={`${config.color.split(' ')[0]} p-2 rounded-xl`}>
                  <Icon className={`h-6 w-6 ${config.color.split(' ')[1]}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters & Actions */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 mb-8">
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, phone, email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-12 pr-4 py-3 w-full bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-xl transition outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-3 w-full lg:w-auto">
            <div className="relative flex-1 lg:flex-none lg:min-w-[160px]">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="pl-9 pr-8 py-3 w-full appearance-none bg-gray-50 border-transparent focus:bg-white border focus:ring-2 focus:ring-indigo-500 rounded-xl transition outline-none text-sm font-medium text-gray-700"
              >
                <option value="">Status: All</option>
                {Object.entries(statusConfig).map(([key, config]) => (
                  <option key={key} value={key}>{config.label}</option>
                ))}
              </select>
            </div>

            <div className="relative flex-1 lg:flex-none lg:min-w-[180px]">
              <Briefcase className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <select
                value={jobFilter}
                onChange={(e) => { setJobFilter(e.target.value); setPage(1); }}
                className="pl-9 pr-8 py-3 w-full appearance-none bg-gray-50 border-transparent focus:bg-white border focus:ring-2 focus:ring-indigo-500 rounded-xl transition outline-none text-sm font-medium text-gray-700"
              >
                <option value="">Job: All Types</option>
                {jobTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {(search || statusFilter || jobFilter) && (
              <button
                onClick={() => { setSearch(''); setStatusFilter(''); setJobFilter(''); setPage(1); }}
                className="p-3 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition"
                title="Clear Filters"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-8 py-5 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">Lead Information</th>
                <th className="px-6 py-5 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">Contact Details</th>
                <th className="px-6 py-5 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">Job Category</th>
                <th className="px-6 py-5 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">Current Status</th>
                <th className="px-6 py-5 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">Registration</th>
                <th className="px-8 py-5 text-right text-xs font-bold text-gray-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin shadow-inner"></div>
                      <p className="text-gray-400 font-bold uppercase tracking-tighter text-sm">Synchronizing Leads...</p>
                    </div>
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 bg-gray-50 rounded-full">
                        <Search className="h-10 w-10 text-gray-200" />
                      </div>
                      <p className="text-gray-400 font-bold text-sm">No leads found matching your criteria</p>
                    </div>
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead._id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
                          {(lead.fullName || 'U').charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900 text-base">{lead.fullName}</div>
                          <div className="text-[10px] font-bold text-gray-400 font-mono tracking-tighter uppercase">PID: {lead._id.slice(-8).toUpperCase()}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
                          <Phone className="h-3.5 w-3.5 text-indigo-400" />
                          {lead.phoneNumber}
                        </div>
                        {lead.email && (
                          <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
                            <Mail className="h-3.5 w-3.5 text-gray-300" />
                            {lead.email}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="inline-flex items-center px-3 py-1 rounded-xl text-[10px] font-bold bg-indigo-50 text-indigo-700 uppercase tracking-wider border border-indigo-100">
                        {lead.jobVacancyType}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="relative inline-block w-full max-w-[140px]">
                        <select
                          value={lead.status}
                          onChange={(e) => handleStatusChange(lead._id, e.target.value)}
                          className={`w-full appearance-none text-xs font-bold px-4 py-2 rounded-2xl border-2 transition cursor-pointer outline-none ${statusConfig[lead.status as keyof typeof statusConfig]?.color}`}
                          style={{ textAlign: 'center' }}
                        >
                          {Object.entries(statusConfig).map(([key, config]) => (
                            <option key={key} value={key} className="bg-white text-gray-900 font-bold">{config.label}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="text-sm text-gray-900 font-bold">
                        {new Date(lead.registeredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                        {new Date(lead.registeredAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`https://wa.me/${lead.phoneNumber.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2.5 text-green-600 bg-green-50 hover:bg-green-600 hover:text-white rounded-xl transition duration-300 shadow-sm"
                          title="WhatsApp Message"
                        >
                          <MessageSquare className="h-4.5 w-4.5" />
                        </a>
                        <button
                          onClick={() => { setSelectedLead(lead); setShowModal(true); }}
                          className="p-2.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-600 hover:text-white rounded-xl transition duration-300 shadow-sm"
                          title="View Details"
                        >
                          <Eye className="h-4.5 w-4.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(lead._id)}
                          className="p-2.5 text-red-500 bg-red-50 hover:bg-red-600 hover:text-white rounded-xl transition duration-300 shadow-sm"
                          title="Delete Lead"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-8 py-6 bg-gray-50/50 border-t border-gray-100">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Showing Page <span className="text-indigo-600">{page}</span> of {totalPages}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 bg-white rounded-xl border border-gray-200 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed hover:border-indigo-500 hover:text-indigo-600 transition"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 bg-white rounded-xl border border-gray-200 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed hover:border-indigo-500 hover:text-indigo-600 transition"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {showModal && selectedLead && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex justify-between items-center px-8 py-6 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-indigo-200">
                  {(selectedLead.fullName || 'U').charAt(0)}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedLead.fullName}</h2>
                  <p className="text-sm text-gray-400 font-medium font-mono uppercase">ID: {selectedLead._id}</p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white rounded-xl transition shadow-sm border border-transparent hover:border-gray-200"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Info */}
                <div className="space-y-6">
                  <section>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Personal Information</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-400 mb-1">
                          <Mail className="h-3 w-3" /> Email Address
                        </label>
                        <p className="font-bold text-gray-900 truncate text-sm">{selectedLead.email || 'N/A'}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-400 mb-1">
                          <Phone className="h-3 w-3" /> Phone Number
                        </label>
                        <p className="font-bold text-gray-900 text-sm">{selectedLead.phoneNumber}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 sm:col-span-2">
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-400 mb-1">
                          <MapPin className="h-3 w-3" /> Home Address
                        </label>
                        <p className="font-bold text-gray-900 text-sm leading-relaxed">{selectedLead.address}</p>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Application Review</h3>
                    <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100">
                      <div className="flex items-start gap-4 mb-4">
                        <div className="p-3 bg-white rounded-xl text-indigo-600 shadow-sm">
                          <Briefcase className="h-6 w-6" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-1">Applying For</label>
                          <p className="text-lg font-extrabold text-indigo-900 leading-tight">{selectedLead.jobVacancyType}</p>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-2">Update Application Status</label>
                        <select
                          value={selectedLead.status}
                          onChange={async (e) => {
                            await handleStatusChange(selectedLead._id, e.target.value);
                            setSelectedLead({ ...selectedLead, status: e.target.value as Lead['status'] });
                          }}
                          className={`w-full appearance-none px-4 py-3 rounded-2xl border-2 font-bold transition outline-none ring-indigo-500/20 focus:ring-4 ${statusConfig[selectedLead.status as keyof typeof statusConfig]?.color}`}
                          style={{ textAlign: 'center' }}
                        >
                          {Object.entries(statusConfig).map(([key, config]) => (
                            <option key={key} value={key} className="bg-white text-gray-900 font-bold">{config.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Right Column: Documents */}
                <div className="space-y-6">
                  <section>
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Qualifications & Transcripts</h3>
                      <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-3 py-1 rounded-full uppercase">
                        {selectedLead.qualifications.length} Files
                      </span>
                    </div>

                    <div className="space-y-3">
                      {selectedLead.qualifications.length === 0 ? (
                        <div className="text-center py-10 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                          <FileText className="h-10 w-10 text-gray-200 mx-auto mb-2" />
                          <p className="text-gray-400 text-xs font-bold uppercase tracking-tight">No documents attached yet</p>
                        </div>
                      ) : (
                        selectedLead.qualifications.map((qual, idx) => (
                          <div key={idx} className="group flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl hover:border-indigo-200 hover:shadow-md transition duration-300">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
                                <FileText className="h-5 w-5" />
                              </div>
                              <div className="overflow-hidden max-w-[180px]">
                                <p className="font-bold text-sm text-gray-900 truncate">{qual.fileName}</p>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                                  {(qual.fileSize / 1024).toFixed(1)} KB • {new Date(qual.uploadedAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <a
                              href={`${import.meta.env.VITE_API_URL || ''}${qual.filePath}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-3 bg-gray-50 text-gray-400 hover:bg-indigo-600 hover:text-white rounded-xl transition duration-200 shadow-sm"
                              title="Download Document"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          </div>
                        ))
                      )}

                      <div className="mt-4 pt-2">
                        <label className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-gray-100 rounded-3xl cursor-pointer hover:bg-indigo-50/30 hover:border-indigo-200 transition-all group">
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUpload(selectedLead._id, file);
                            }}
                            disabled={uploading}
                            className="hidden"
                          />
                          <div className="p-3 bg-gray-100 rounded-2xl mb-3 text-gray-400 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition duration-300">
                            <Upload className="h-6 w-6" />
                          </div>
                          <span className="text-sm font-bold text-gray-500 group-hover:text-indigo-900 transition">
                            {uploading ? 'Processing File...' : 'Attach Qualification'}
                          </span>
                          <span className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-widest group-hover:text-indigo-400">
                            PDF, PNG, JPG (Max 5MB)
                          </span>
                        </label>
                      </div>
                    </div>
                  </section>

                  <section className="mt-8 border-t border-gray-100 pt-8">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">WhatsApp Conversation</h3>
                      <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full uppercase">
                        {messages.length} Messages
                      </span>
                    </div>

                    <div className="space-y-4 bg-gray-50 p-5 rounded-3xl max-h-[400px] overflow-y-auto border border-gray-100">
                      {loadingMessages ? (
                        <p className="text-center text-sm font-bold text-gray-400 py-8 animate-pulse">Loading conversation...</p>
                      ) : messages.length === 0 ? (
                        <div className="text-center py-10">
                          <MessageSquare className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                          <p className="text-gray-400 text-xs font-bold uppercase tracking-tight">No message history found</p>
                        </div>
                      ) : (
                        messages.map((msg, idx) => (
                          <div key={idx} className={`flex ${msg.role === 'assistant' || msg.role === 'system' ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${msg.role === 'assistant' || msg.role === 'system' ? 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm' : 'bg-indigo-600 text-white rounded-tr-sm'}`}>
                              <p className="whitespace-pre-wrap font-medium">{msg.content}</p>
                              <p className={`text-[9px] mt-1.5 font-bold tracking-wider uppercase ${msg.role === 'assistant' || msg.role === 'system' ? 'text-gray-400' : 'text-indigo-200'}`}>
                                {new Date(msg.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>

            {/* Modal Footer / Actions */}
            <div className="px-8 py-6 bg-gray-50/80 border-t border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center">
              <div className="flex gap-2">
                <a
                  href={`https://wa.me/${selectedLead.phoneNumber.replace(/[^0-9]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-2xl font-bold shadow-lg shadow-green-200 hover:bg-green-700 hover:-translate-y-0.5 transition active:translate-y-0"
                >
                  <MessageSquare className="h-5 w-5" /> Message via WhatsApp
                </a>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleDelete(selectedLead._id)}
                  className="px-6 py-3 border-2 border-red-50 text-red-500 hover:bg-red-50 rounded-2xl font-bold transition duration-300"
                >
                  Remove Record
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-8 py-3 bg-white border-2 border-gray-100 text-gray-600 hover:border-gray-200 rounded-2xl font-bold shadow-sm transition duration-300"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div className={`fixed bottom-8 right-8 flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl animate-in slide-in-from-right duration-300 z-[100] border ${notification.type === 'success' ? 'bg-green-600 text-white border-green-500' :
          notification.type === 'error' ? 'bg-red-600 text-white border-red-500' :
            'bg-indigo-600 text-white border-indigo-500'
          }`}>
          {notification.type === 'success' ? <CheckCircle className="h-5 w-5" /> :
            notification.type === 'error' ? <AlertCircle className="h-5 w-5" /> :
              <FileText className="h-5 w-5" />}
          <p className="font-bold text-sm tracking-tight">{notification.message}</p>
          <button onClick={() => setNotification(null)} className="ml-2 hover:opacity-70">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
