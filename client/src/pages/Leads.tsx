import { useState, useEffect } from 'react';
import { api } from '../config';
import { 
  Search, Download, Upload, 
  Eye, Trash2, X, FileText, CheckCircle, 
  XCircle, Clock, ChevronLeft, ChevronRight 
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

const statusConfig = {
  new: { label: 'New', color: 'bg-blue-100 text-blue-700', icon: Clock },
  reviewed: { label: 'Reviewed', color: 'bg-yellow-100 text-yellow-700', icon: Eye },
  contacted: { label: 'Contacted', color: 'bg-purple-100 text-purple-700', icon: Clock },
  accepted: { label: 'Accepted', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700', icon: XCircle }
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
  const [stats, setStats] = useState<any>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [uploading, setUploading] = useState(false);

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
  }, [page, search, statusFilter, jobFilter]);

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      await api.put(`/api/leads/${leadId}`, { status: newStatus });
      fetchLeads();
      fetchStats();
    } catch (err) {
      alert('Failed to update status');
    }
  };

  const handleDelete = async (leadId: string) => {
    if (!confirm('Are you sure you want to delete this lead?')) return;
    try {
      await api.delete(`/api/leads/${leadId}`);
      fetchLeads();
      fetchStats();
    } catch (err) {
      alert('Failed to delete lead');
    }
  };

  const handleFileUpload = async (leadId: string, file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', 'qualification');

    try {
      await api.post(`/api/leads/${leadId}/qualifications`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      fetchLeads();
      alert('File uploaded successfully!');
    } catch (err) {
      alert('Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Leads & Registrations</h1>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <p className="text-sm text-gray-500">Total Leads</p>
          <p className="text-2xl font-bold">{stats.totalLeads || 0}</p>
        </div>
        {Object.entries(statusConfig).map(([key, config]) => (
          <div key={key} className="bg-white p-4 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500">{config.label}</p>
            <p className="text-2xl font-bold">{stats.byStatus?.[key] || 0}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-md mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, phone, email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-10 pr-4 py-2 w-full border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            {Object.entries(statusConfig).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>

          <select
            value={jobFilter}
            onChange={(e) => { setJobFilter(e.target.value); setPage(1); }}
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Job Types</option>
            {jobTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Registered</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">No leads found</td>
                </tr>
              ) : (
                leads.map((lead, index) => (
                  <tr key={lead._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-500">#{index + 1 + (page - 1) * 20}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{lead.fullName}</div>
                      {lead.email && <div className="text-sm text-gray-500">{lead.email}</div>}
                    </td>
                    <td className="px-6 py-4 text-sm">{lead.phoneNumber}</td>
                    <td className="px-6 py-4 text-sm">{lead.jobVacancyType}</td>
                    <td className="px-6 py-4">
                      <select
                        value={lead.status}
                        onChange={(e) => handleStatusChange(lead._id, e.target.value)}
                        className={`text-xs px-2 py-1 rounded-full border-0 cursor-pointer ${statusConfig[lead.status as keyof typeof statusConfig]?.color}`}
                      >
                        {Object.entries(statusConfig).map(([key, config]) => (
                          <option key={key} value={key}>{config.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(lead.registeredAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setSelectedLead(lead); setShowModal(true); }}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(lead._id)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
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
          <div className="flex items-center justify-between px-6 py-4 border-t">
            <p className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded border disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {showModal && selectedLead && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-xl font-bold">Lead Details</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-500">Full Name</label>
                  <p className="font-medium">{selectedLead.fullName}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Phone Number</label>
                  <p className="font-medium">{selectedLead.phoneNumber}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Email</label>
                  <p className="font-medium">{selectedLead.email || '-'}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Job Vacancy Type</label>
                  <p className="font-medium">{selectedLead.jobVacancyType}</p>
                </div>
              </div>
              
              <div>
                <label className="text-sm text-gray-500">Address</label>
                <p className="font-medium">{selectedLead.address}</p>
              </div>

              <div>
                <label className="text-sm text-gray-500">Status</label>
                <div className="mt-1">
                  <select
                    value={selectedLead.status}
                    onChange={async (e) => {
                      await handleStatusChange(selectedLead._id, e.target.value);
                      setSelectedLead({ ...selectedLead, status: e.target.value as any });
                    }}
                    className="px-3 py-2 border rounded-lg"
                  >
                    {Object.entries(statusConfig).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-500">Qualifications</label>
                <div className="mt-2 space-y-2">
                  {selectedLead.qualifications.length === 0 ? (
                    <p className="text-gray-400 italic">No documents uploaded</p>
                  ) : (
                    selectedLead.qualifications.map((qual, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <FileText className="h-5 w-5 text-gray-400" />
                          <div>
                            <p className="font-medium text-sm">{qual.fileName}</p>
                            <p className="text-xs text-gray-500">
                              {(qual.fileSize / 1024).toFixed(1)} KB • {new Date(qual.uploadedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <a
                          href={`${import.meta.env.VITE_API_URL || ''}/api${qual.filePath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </div>
                    ))
                  )}
                  
                  <div className="mt-2">
                    <label className="flex items-center justify-center w-full p-4 border-2 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
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
                      <Upload className="h-5 w-5 text-gray-400 mr-2" />
                      <span className="text-sm text-gray-500">
                        {uploading ? 'Uploading...' : 'Upload Qualification (PDF/Image)'}
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-500">Registered Date</label>
                <p className="font-medium">{new Date(selectedLead.registeredAt).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
