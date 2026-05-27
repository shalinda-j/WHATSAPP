import { useState, useEffect } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { api } from '../config';
import {
  Users,
  DollarSign,
  Target,
  TrendingUp,
  Search,
  Plus,
  X,
  Phone,
  Mail,
  Calendar,
  Clock,
  CheckCircle,
  Edit,
  Trash2,
  MessageSquare,
  UserPlus,
  BarChart3,
  Activity,
  CheckSquare,
  MessageCircle,
  FileText,
  Mic,
  Download,
  Eye,
  Upload,
  RotateCcw,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Briefcase,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const COLORS = [
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#ef4444',
  '#6366f1',
  '#ec4899',
  '#06b6d4',
];

// Types
interface Contact {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  company?: string;
  position?: string;
  type: 'lead' | 'prospect' | 'customer' | 'partner' | 'vendor';
  source: string;
  status: 'active' | 'inactive' | 'churned';
  tags: string[];
  notes?: string;
  lastContactedAt?: Date;
  createdAt: Date;
}

interface Deal {
  _id: string;
  title: string;
  description?: string;
  value: number;
  currency: string;
  stage: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  probability: number;
  contact?: Contact;
  expectedCloseDate?: Date;
  createdAt: Date;
}

interface ActivityItem {
  _id: string;
  type: 'call' | 'meeting' | 'email' | 'whatsapp' | 'task' | 'note';
  title: string;
  description?: string;
  contact?: Contact;
  deal?: Deal;
  status: 'pending' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  dueDate?: Date;
  createdAt: Date;
}

// Analytics Types
interface OverviewStats {
  totalMessages: number;
  todayMessages: number;
  weekMessages: number;
  monthMessages: number;
  totalUsers: number;
  voiceMessages: number;
  textMessages: number;
  botMessages: number;
  userMessages: number;
  avgMessagesPerUser: string;
}

interface QuestionCategory {
  category: string;
  count: number;
}

interface TopQuestion {
  question: string;
  count: number;
}

interface TrendData {
  date: string;
  messages: number;
  users: number;
}

interface LeadStats {
  totalLeads: number;
  weekLeads: number;
  byStatus: Record<string, number>;
  byJobType: Record<string, number>;
}

interface ChatbotReply {
  id: string;
  content: string;
  type: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// Lead Registration Types
interface LeadRegistration {
  _id: string;
  fullName: string;
  phoneNumber: string;
  age?: number;
  email?: string;
  address?: string;
  interestedCountry?: string;
  experienceYears?: string;
  jobVacancyType: string;
  cvUrl?: string;
  cvFileName?: string;
  cvUploadedAt?: Date;
  qualifications: {
    documentType: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    extractedText?: string;
    uploadedAt: Date;
  }[];
  status:
    | 'new'
    | 'reviewed'
    | 'contacted'
    | 'interviewed'
    | 'accepted'
    | 'rejected';
  notes?: string;
  registeredAt: Date;
}

const leadStatusConfig = {
  new: {
    label: 'New',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: Clock,
  },
  reviewed: {
    label: 'Reviewed',
    color: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    icon: Eye,
  },
  contacted: {
    label: 'Contacted',
    color: 'bg-purple-50 text-purple-700 border-purple-200',
    icon: Phone,
  },
  interviewed: {
    label: 'Interviewed',
    color: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    icon: Calendar,
  },
  accepted: {
    label: 'Accepted',
    color: 'bg-green-50 text-green-700 border-green-200',
    icon: CheckCircle,
  },
  rejected: {
    label: 'Rejected',
    color: 'bg-red-50 text-red-700 border-red-200',
    icon: X,
  },
};

// Tab configuration
const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'deals', label: 'Deals', icon: DollarSign },
  { id: 'leads', label: 'Registrations', icon: UserPlus },
  { id: 'activities', label: 'Activities', icon: Activity },
];

// Stage colors for Kanban
const stageColors: Record<string, string> = {
  new: 'bg-blue-50 border-blue-200',
  qualified: 'bg-cyan-50 border-cyan-200',
  proposal: 'bg-yellow-50 border-yellow-200',
  negotiation: 'bg-orange-50 border-orange-200',
  won: 'bg-green-50 border-green-200',
  lost: 'bg-red-50 border-red-200',
};

const stageLabels: Record<string, string> = {
  new: 'New',
  qualified: 'Qualified',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

// Contact type colors
const typeColors: Record<string, string> = {
  lead: 'bg-blue-100 text-blue-700',
  prospect: 'bg-purple-100 text-purple-700',
  customer: 'bg-green-100 text-green-700',
  partner: 'bg-orange-100 text-orange-700',
  vendor: 'bg-gray-100 text-gray-700',
};

interface DashboardStats {
  contacts: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
  };
  deals: {
    total: number;
    totalValue: number;
    wonValue: number;
    byStage: Record<string, { count: number; value: number }>;
  };
  conversionRate: string;
  upcomingActivities: ActivityItem[];
  recentContacts: Contact[];
  recentDeals: Deal[];
}

interface RegistrationStats {
  total: number;
  totalLeads?: number;
  byStatus: Record<string, number>;
  byJobType: Record<string, number>;
}

interface RegistrationMessage {
  id: string;
  content: string;
  type: string;
  timestamp: string;
  sender: string;
}

interface SessionSummary {
  sessionId: string;
  sessionName?: string;
  status?: string;
}

export default function CRM() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  // Per-device scope. 'all' shows every record across sessions; selecting
  // a sessionId narrows every CRM tab + dashboard tile to that device's
  // slice (mirrors the device picker on the Chat page).
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionFilter, setSessionFilter] = useState<string>('all');

  // Dashboard state
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(
    null,
  );

  // Contacts state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [, setContactsTotal] = useState(0);
  const [contactsPage] = useState(1);
  const [contactSearch, setContactSearch] = useState('');
  const debouncedContactSearch = useDebounce(contactSearch, 300);
  const [contactTypeFilter] = useState('');
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  // Deals state
  const [, setDeals] = useState<Deal[]>([]);
  const [dealsByStage, setDealsByStage] = useState<Record<string, Deal[]>>({});
  const [, setDealsTotal] = useState(0);
  const [dealsPage] = useState(1);
  const [dealSearch] = useState('');
  const [dealStageFilter] = useState('');
  const [showDealModal, setShowDealModal] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);

  // Lightweight lists used only by Deal / Activity modal pickers so we don't
  // depend on the user having visited the Contacts or Deals tab first.
  const [modalContacts, setModalContacts] = useState<
    { _id: string; firstName: string; lastName: string; company?: string }[]
  >([]);
  const [modalDeals, setModalDeals] = useState<
    { _id: string; title: string }[]
  >([]);

  // Activities state
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [, setActivitiesTotal] = useState(0);
  const [activitiesPage] = useState(1);
  const [activityTypeFilter] = useState('');
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityItem | null>(
    null,
  );

  // Form states
  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    position: '',
    type: 'lead',
    source: 'other',
    status: 'active',
    tags: '',
    notes: '',
  });

  const [dealForm, setDealForm] = useState({
    title: '',
    description: '',
    value: 0,
    currency: 'USD',
    stage: 'new',
    probability: 10,
    contact: '',
    expectedCloseDate: '',
  });

  const [activityForm, setActivityForm] = useState({
    type: 'task',
    title: '',
    description: '',
    contact: '',
    deal: '',
    status: 'pending',
    priority: 'medium',
    dueDate: '',
  });

  // Analytics state
  const [analyticsOverview, setAnalyticsOverview] =
    useState<OverviewStats | null>(null);
  const [questionCategories, setQuestionCategories] = useState<
    QuestionCategory[]
  >([]);
  const [topQuestions, setTopQuestions] = useState<TopQuestion[]>([]);
  const [, setRecentReplies] = useState<ChatbotReply[]>([]);
  const [messageTrends, setMessageTrends] = useState<TrendData[]>([]);
  const [leadAnalyticsStats, setLeadAnalyticsStats] =
    useState<LeadStats | null>(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState('7');

  // Leads Registrations state
  const [registrations, setRegistrations] = useState<LeadRegistration[]>([]);
  const [, setRegistrationsTotal] = useState(0);
  const [registrationsPage, setRegistrationsPage] = useState(1);
  const [registrationsTotalPages, setRegistrationsTotalPages] = useState(1);
  const [registrationSearch, setRegistrationSearch] = useState('');
  const debouncedRegistrationSearch = useDebounce(registrationSearch, 300);
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState('');
  const [registrationJobFilter, setRegistrationJobFilter] = useState('');
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [registrationStats, setRegistrationStats] =
    useState<RegistrationStats | null>(null);
  const [selectedRegistration, setSelectedRegistration] =
    useState<LeadRegistration | null>(null);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [, setRegistrationMessages] = useState<RegistrationMessage[]>([]);
  const [, setLoadingRegistrationMessages] = useState(false);
  const [uploadingQualification, setUploadingQualification] = useState(false);
  const [registrationNotification, setRegistrationNotification] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  // Fetch functions
  const fetchDashboard = async () => {
    try {
      const params = new URLSearchParams();
      if (sessionFilter && sessionFilter !== 'all') {
        params.append('sessionId', sessionFilter);
      }
      const qs = params.toString();
      const res = await api.get(`/api/crm/dashboard${qs ? `?${qs}` : ''}`);
      setDashboardStats(res.data);
    } catch (err) {
      console.error('Failed to fetch dashboard', err);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await api.get('/api/sessions');
      setSessions(res.data.sessions || []);
    } catch (err) {
      console.error('Failed to fetch sessions', err);
    }
  };

  const appendSessionScope = (params: URLSearchParams) => {
    if (sessionFilter && sessionFilter !== 'all') {
      params.append('sessionId', sessionFilter);
    }
  };

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', contactsPage.toString());
      params.append('limit', '20');
      if (debouncedContactSearch) params.append('search', debouncedContactSearch);
      if (contactTypeFilter) params.append('type', contactTypeFilter);
      appendSessionScope(params);

      const res = await api.get(`/api/crm/contacts?${params}`);
      setContacts(res.data.contacts);
      setContactsTotal(res.data.total);
    } catch (err) {
      console.error('Failed to fetch contacts', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', dealsPage.toString());
      params.append('limit', '20');
      if (dealSearch) params.append('search', dealSearch);
      if (dealStageFilter) params.append('stage', dealStageFilter);
      appendSessionScope(params);

      const res = await api.get(`/api/crm/deals?${params}`);
      setDeals(res.data.deals);
      setDealsTotal(res.data.total);
    } catch (err) {
      console.error('Failed to fetch deals', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDealsKanban = async () => {
    try {
      const params = new URLSearchParams();
      appendSessionScope(params);
      const qs = params.toString();
      const res = await api.get(
        `/api/crm/deals/kanban${qs ? `?${qs}` : ''}`,
      );
      setDealsByStage(res.data);
    } catch (err) {
      console.error('Failed to fetch deals kanban', err);
    }
  };

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', activitiesPage.toString());
      params.append('limit', '20');
      if (activityTypeFilter) params.append('type', activityTypeFilter);
      appendSessionScope(params);

      const res = await api.get(`/api/crm/activities?${params}`);
      setActivities(res.data.activities);
      setActivitiesTotal(res.data.total);
    } catch (err) {
      console.error('Failed to fetch activities', err);
    } finally {
      setLoading(false);
    }
  };

  // Analytics fetch — declared before useEffect to satisfy react-hooks/immutability
  const fetchAnalytics = async () => {
    try {
      const [
        overviewRes,
        questionsRes,
        topRes,
        trendsRes,
        leadsRes,
        repliesRes,
      ] = await Promise.all([
        api.get('/api/analytics/overview'),
        api.get('/api/analytics/questions'),
        api.get('/api/analytics/top-questions?limit=15'),
        api.get(`/api/analytics/trends?days=${analyticsPeriod}`),
        api.get('/api/analytics/leads'),
        api.get('/api/analytics/recent-replies?limit=10'),
      ]);

      setAnalyticsOverview(overviewRes.data);
      setQuestionCategories(questionsRes.data.categories || []);
      setTopQuestions(topRes.data);
      setMessageTrends(trendsRes.data);
      setLeadAnalyticsStats(leadsRes.data);
      setRecentReplies(repliesRes.data);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    }
  };

  const fetchRegistrations = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', registrationsPage.toString());
      params.append('limit', '20');
      if (debouncedRegistrationSearch) params.append('search', debouncedRegistrationSearch);
      if (registrationStatusFilter)
        params.append('status', registrationStatusFilter);
      if (registrationJobFilter)
        params.append('jobType', registrationJobFilter);
      appendSessionScope(params);

      const res = await api.get(`/api/crm/registrations?${params}`);
      setRegistrations(res.data.registrations);
      setRegistrationsTotal(res.data.total);
      setRegistrationsTotalPages(res.data.totalPages);
    } catch (err) {
      console.error('Failed to fetch registrations:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRegistrationStats = async () => {
    try {
      const res = await api.get('/api/crm/registrations/stats');
      setRegistrationStats(res.data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchJobTypes = async () => {
    try {
      const res = await api.get('/api/crm/registrations/stats');
      const types = Object.keys(res.data.byJobType || {});
      setJobTypes(
        types.length > 0
          ? types
          : [
              'Electrician',
              'Plumber',
              'Asphalt Worker',
              'Concrete Pump Driver',
              'Excavator Operator',
              'JCB Operator',
              'Heavy Duty Cleaner',
              'Gypsum Fixer',
              'Tile Fixer',
              'General Worker',
              'Welder',
              'Carpenter',
              'Mason',
              'Painter',
              'AC Technician',
              'Driver',
            ],
      );
    } catch (err) {
      console.error('Failed to fetch job types:', err);
      setJobTypes([
        'Electrician',
        'Plumber',
        'Asphalt Worker',
        'Concrete Pump Driver',
        'Excavator Operator',
        'JCB Operator',
        'Heavy Duty Cleaner',
        'Gypsum Fixer',
        'Tile Fixer',
        'General Worker',
      ]);
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchDashboard();
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch dashboard whenever the device scope changes; the per-tab
  // effect below picks up sessionFilter through its own dep too.
  useEffect(() => {
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionFilter]);

  useEffect(() => {
    if (activeTab === 'contacts') fetchContacts();
    if (activeTab === 'deals') {
      fetchDeals();
      fetchDealsKanban();
    }
    if (activeTab === 'activities') fetchActivities();
    if (activeTab === 'analytics') fetchAnalytics();
    if (activeTab === 'leads') {
      fetchRegistrations();
      fetchRegistrationStats();
      fetchJobTypes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    sessionFilter,
    contactsPage,
    debouncedContactSearch,  // debounced — fires 300 ms after the user stops typing
    contactTypeFilter,
    dealsPage,
    dealSearch,
    dealStageFilter,
    activitiesPage,
    activityTypeFilter,
    analyticsPeriod,
    registrationsPage,
    debouncedRegistrationSearch,  // debounced
    registrationStatusFilter,
    registrationJobFilter,
  ]);

  // Contact handlers
  const handleSaveContact = async () => {
    try {
      const data = {
        ...contactForm,
        tags: contactForm.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };

      if (editingContact) {
        await api.put(`/api/crm/contacts/${editingContact._id}`, data);
      } else {
        // Stamp the active device scope so the new row appears in the
        // currently-selected tab — invisible-after-save bug from PR #21
        // would otherwise recur for device-scoped views.
        const payload =
          sessionFilter && sessionFilter !== 'all'
            ? { ...data, sessionId: sessionFilter }
            : data;
        await api.post('/api/crm/contacts', payload);
      }
      setShowContactModal(false);
      setEditingContact(null);
      resetContactForm();
      fetchContacts();
      fetchDashboard();
    } catch {
      alert('Failed to save contact');
    }
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    try {
      await api.delete(`/api/crm/contacts/${id}`);
      fetchContacts();
      fetchDashboard();
    } catch {
      alert('Failed to delete contact');
    }
  };

  const resetContactForm = () => {
    setContactForm({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      company: '',
      position: '',
      type: 'lead',
      source: 'other',
      status: 'active',
      tags: '',
      notes: '',
    });
  };

  // Deal handlers
  const handleSaveDeal = async () => {
    try {
      const data = {
        ...dealForm,
        value: Number(dealForm.value),
        probability: Number(dealForm.probability),
      };

      if (editingDeal) {
        await api.put(`/api/crm/deals/${editingDeal._id}`, data);
      } else {
        const payload =
          sessionFilter && sessionFilter !== 'all'
            ? { ...data, sessionId: sessionFilter }
            : data;
        await api.post('/api/crm/deals', payload);
      }
      setShowDealModal(false);
      setEditingDeal(null);
      resetDealForm();
      fetchDeals();
      fetchDealsKanban();
      fetchDashboard();
    } catch {
      alert('Failed to save deal');
    }
  };

  const handleDeleteDeal = async (id: string) => {
    if (!confirm('Are you sure you want to delete this deal?')) return;
    try {
      await api.delete(`/api/crm/deals/${id}`);
      fetchDeals();
      fetchDealsKanban();
      fetchDashboard();
    } catch {
      alert('Failed to delete deal');
    }
  };

  const resetDealForm = () => {
    setDealForm({
      title: '',
      description: '',
      value: 0,
      currency: 'USD',
      stage: 'new',
      probability: 10,
      contact: '',
      expectedCloseDate: '',
    });
  };

  /** Fetch a lightweight contact list for the Deal / Activity modal pickers. */
  const fetchModalContacts = async () => {
    try {
      const params = new URLSearchParams({ limit: '200' });
      appendSessionScope(params);
      const res = await api.get(`/api/crm/contacts?${params.toString()}`);
      setModalContacts(
        (res.data.contacts ?? res.data ?? []).map((c: any) => ({
          _id: c._id,
          firstName: c.firstName,
          lastName: c.lastName,
          company: c.company,
        })),
      );
    } catch {
      /* non-fatal — picker just stays empty */
    }
  };

  /** Fetch a lightweight deal list for the Activity modal picker. */
  const fetchModalDeals = async () => {
    try {
      const params = new URLSearchParams({ limit: '200' });
      appendSessionScope(params);
      const res = await api.get(`/api/crm/deals?${params.toString()}`);
      setModalDeals(
        (res.data.deals ?? res.data ?? []).map((d: any) => ({
          _id: d._id,
          title: d.title,
        })),
      );
    } catch {
      /* non-fatal */
    }
  };

  // Activity handlers
  const handleSaveActivity = async () => {
    try {
      if (editingActivity) {
        await api.put(
          `/api/crm/activities/${editingActivity._id}`,
          activityForm,
        );
      } else {
        const payload =
          sessionFilter && sessionFilter !== 'all'
            ? { ...activityForm, sessionId: sessionFilter }
            : activityForm;
        await api.post('/api/crm/activities', payload);
      }
      setShowActivityModal(false);
      setEditingActivity(null);
      resetActivityForm();
      fetchActivities();
      fetchDashboard();
    } catch {
      alert('Failed to save activity');
    }
  };

  const handleDeleteActivity = async (id: string) => {
    if (!confirm('Are you sure you want to delete this activity?')) return;
    try {
      await api.delete(`/api/crm/activities/${id}`);
      fetchActivities();
      fetchDashboard();
    } catch {
      alert('Failed to delete activity');
    }
  };

  const handleCompleteActivity = async (id: string) => {
    try {
      await api.put(`/api/crm/activities/${id}`, { status: 'completed' });
      fetchActivities();
      fetchDashboard();
    } catch {
      alert('Failed to complete activity');
    }
  };

  const resetActivityForm = () => {
    setActivityForm({
      type: 'task',
      title: '',
      description: '',
      contact: '',
      deal: '',
      status: 'pending',
      priority: 'medium',
      dueDate: '',
    });
  };

  // Leads Registration handlers
  const _fetchRegistrationMessages = async (leadId: string) => {
    setLoadingRegistrationMessages(true);
    try {
      const res = await api.get(`/api/leads/${leadId}/messages`);
      setRegistrationMessages(res.data.messages || []);
    } catch (error) {
      console.error('Failed to fetch messages', error);
      setRegistrationMessages([]);
    } finally {
      setLoadingRegistrationMessages(false);
    }
  };

  const showRegistrationNotify = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info',
  ) => {
    setRegistrationNotification({ message, type });
    setTimeout(() => setRegistrationNotification(null), 3000);
  };

  const handleRegistrationStatusChange = async (
    leadId: string,
    newStatus: string,
  ) => {
    try {
      await api.put(`/api/crm/registrations/${leadId}/status`, {
        status: newStatus,
      });
      fetchRegistrations();
      fetchRegistrationStats();
      showRegistrationNotify('Status updated', 'success');
    } catch {
      showRegistrationNotify('Failed to update status', 'error');
    }
  };

  const handleDeleteRegistration = async (leadId: string) => {
    if (!confirm('Are you sure you want to delete this registration?')) return;
    try {
      await api.delete(`/api/crm/registrations/${leadId}`);
      if (showRegistrationModal && selectedRegistration?._id === leadId) {
        setShowRegistrationModal(false);
        setSelectedRegistration(null);
      }
      fetchRegistrations();
      fetchRegistrationStats();
      showRegistrationNotify('Registration deleted successfully', 'success');
    } catch {
      showRegistrationNotify('Failed to delete registration', 'error');
    }
  };

  const handleQualificationUpload = async (leadId: string, file: File) => {
    setUploadingQualification(true);
    const formData = new FormData();
    formData.append('cv', file);

    try {
      const res = await api.post(
        `/api/crm/registrations/${leadId}/cv`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      );
      if (selectedRegistration && selectedRegistration._id === leadId) {
        setSelectedRegistration({
          ...selectedRegistration,
          cvUrl: res.data.cvUrl,
          cvFileName: res.data.fileName,
          cvUploadedAt: new Date(),
        });
      }
      fetchRegistrations();
      showRegistrationNotify('CV uploaded successfully', 'success');
    } catch {
      showRegistrationNotify('Upload failed', 'error');
    } finally {
      setUploadingQualification(false);
    }
  };

  const handleExportLeadsCSV = async () => {
    try {
      const res = await api.get('/api/crm/registrations/export', {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `registrations-export-${new Date().toISOString().split('T')[0]}.csv`,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      showRegistrationNotify('Export downloaded successfully', 'success');
    } catch {
      showRegistrationNotify('Failed to export CSV', 'error');
    }
  };

  /**
   * Tenant-scoped CSV export hitting the /api/export/* endpoints (PR #42).
   * Used for the Contacts tab — wraps the blob → click → revoke dance so
   * the per-tab button handler stays a single line.
   */
  const downloadCsv = async (path: string, filename: string) => {
    try {
      const res = await api.get(path, { responseType: 'blob' });
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: 'text/csv;charset=utf-8;' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showRegistrationNotify('Export downloaded successfully', 'success');
    } catch {
      showRegistrationNotify('Failed to export CSV', 'error');
    }
  };

  const handleExportContactsCSV = () => {
    const date = new Date().toISOString().split('T')[0];
    const params = new URLSearchParams();
    appendSessionScope(params);
    const qs = params.toString();
    return downloadCsv(
      `/api/export/contacts.csv${qs ? `?${qs}` : ''}`,
      `crm-contacts-${date}.csv`,
    );
  };

  const handleExportAllLeadsCSV = () => {
    const date = new Date().toISOString().split('T')[0];
    return downloadCsv('/api/export/leads.csv', `leads-${date}.csv`);
  };

  const getCategoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      jobs: 'Jobs & Work',
      register: 'Registration',
      payment: 'Payment & Salary',
      booking: 'Bookings & Visits',
      location: 'Location & Address',
      services: 'Services & Help',
      hello: 'Greetings',
      language: 'Language',
    };
    return labels[cat] || cat;
  };

  // Render Dashboard
  const renderDashboard = () => (
    <div className="space-y-8">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-6 rounded-2xl shadow-lg text-white">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-blue-100 text-sm font-medium">
                Total Contacts
              </p>
              <p className="text-3xl font-bold mt-1">
                {dashboardStats?.contacts?.total || 0}
              </p>
            </div>
            <div className="bg-white/20 p-3 rounded-xl">
              <Users className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-green-600 p-6 rounded-2xl shadow-lg text-white">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-green-100 text-sm font-medium">Total Deals</p>
              <p className="text-3xl font-bold mt-1">
                {dashboardStats?.deals?.total || 0}
              </p>
            </div>
            <div className="bg-white/20 p-3 rounded-xl">
              <DollarSign className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 p-6 rounded-2xl shadow-lg text-white">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-purple-100 text-sm font-medium">
                Pipeline Value
              </p>
              <p className="text-3xl font-bold mt-1">
                ${(dashboardStats?.deals?.totalValue || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-white/20 p-3 rounded-xl">
              <Target className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-6 rounded-2xl shadow-lg text-white">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-orange-100 text-sm font-medium">Won Deals</p>
              <p className="text-3xl font-bold mt-1">
                ${(dashboardStats?.deals?.wonValue || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-white/20 p-3 rounded-xl">
              <TrendingUp className="h-6 w-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Conversion Rate & Upcoming Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-blue-500" />
            Conversion Rate
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex-1 bg-gray-100 rounded-full h-4">
              <div
                className="bg-green-500 h-4 rounded-full transition-all duration-500"
                style={{ width: `${dashboardStats?.conversionRate || 0}%` }}
              />
            </div>
            <span className="text-2xl font-bold text-gray-800">
              {dashboardStats?.conversionRate || 0}%
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-2">Won deals / Total deals</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-orange-500" />
            Upcoming Activities
          </h3>
          {(dashboardStats?.upcomingActivities?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              {dashboardStats?.upcomingActivities
                ?.slice(0, 4)
                .map((activity: ActivityItem) => (
                  <div
                    key={activity._id}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl"
                  >
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <CheckSquare className="h-4 w-4 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-800 text-sm">
                        {activity.title}
                      </p>
                      <p className="text-xs text-gray-500">
                        {activity.dueDate
                          ? new Date(activity.dueDate).toLocaleDateString()
                          : 'No due date'}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No upcoming activities</p>
          )}
        </div>
      </div>

      {/* Recent Contacts & Deals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-blue-500" />
            Recent Contacts
          </h3>
          {(dashboardStats?.recentContacts?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              {dashboardStats?.recentContacts?.map((contact: Contact) => (
                <div
                  key={contact._id}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl"
                >
                  <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                    {(contact.firstName || 'U').charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-800 text-sm">
                      {contact.firstName} {contact.lastName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {contact.company || contact.email || 'No company'}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      typeColors[contact.type]
                    }`}
                  >
                    {contact.type}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No contacts yet</p>
          )}
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-500" />
            Recent Deals
          </h3>
          {(dashboardStats?.recentDeals?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              {dashboardStats?.recentDeals?.map((deal: Deal) => (
                <div
                  key={deal._id}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl"
                >
                  <div className="p-2 bg-green-100 rounded-lg">
                    <DollarSign className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-800 text-sm">
                      {deal.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      ${deal.value.toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      stageColors[deal.stage]
                    } border`}
                  >
                    {stageLabels[deal.stage]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No deals yet</p>
          )}
        </div>
      </div>
    </div>
  );

  // Render Contacts
  const renderContacts = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex-1 w-full md:w-auto">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search contacts..."
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              className="pl-12 pr-4 py-3 w-full md:w-80 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportContactsCSV}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition"
            title="Download all contacts as CSV"
          >
            <Download className="h-5 w-5" /> Export CSV
          </button>
          <button
            onClick={() => {
              resetContactForm();
              setEditingContact(null);
              setShowContactModal(true);
            }}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition"
          >
            <Plus className="h-5 w-5" /> Add Contact
          </button>
        </div>
      </div>

      {/* Contacts Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Contact
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Company
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Type
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Source
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Status
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-gray-400 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-gray-400"
                  >
                    Loading...
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-gray-400"
                  >
                    No contacts found
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => (
                  <tr key={contact._id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                          {(contact.firstName || 'U').charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">
                            {contact.firstName} {contact.lastName}
                          </p>
                          <p className="text-sm text-gray-500">
                            {contact.email || contact.phone}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {contact.company || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          typeColors[contact.type]
                        }`}
                      >
                        {contact.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 capitalize">
                      {contact.source}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          contact.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : contact.status === 'inactive'
                              ? 'bg-gray-100 text-gray-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {contact.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`https://wa.me/${contact.phone.replace(
                            /[^0-9]/g,
                            '',
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => {
                            setEditingContact(contact);
                            setContactForm({
                              firstName: contact.firstName,
                              lastName: contact.lastName,
                              email: contact.email || '',
                              phone: contact.phone,
                              company: contact.company || '',
                              position: contact.position || '',
                              type: contact.type,
                              source: contact.source,
                              status: contact.status,
                              tags: contact.tags.join(', '),
                              notes: contact.notes || '',
                            });
                            setShowContactModal(true);
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteContact(contact._id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
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
      </div>
    </div>
  );

  // Render Deals (Kanban)
  const renderDeals = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-xl font-bold text-gray-800">Sales Pipeline</h2>
        <button
          onClick={() => {
            resetDealForm();
            setEditingDeal(null);
            void fetchModalContacts();
            setShowDealModal(true);
          }}
          className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition"
        >
          <Plus className="h-5 w-5" /> Add Deal
        </button>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 overflow-x-auto pb-4">
        {Object.entries(stageLabels).map(([stage, label]) => (
          <div key={stage} className="min-w-[280px]">
            <div className={`p-3 rounded-t-xl ${stageColors[stage]} border`}>
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{label}</h3>
                <span className="bg-white/50 px-2 py-1 rounded-full text-xs font-medium">
                  {dealsByStage[stage]?.length || 0}
                </span>
              </div>
            </div>
            <div className="bg-gray-50 p-3 rounded-b-xl min-h-[200px] space-y-3">
              {dealsByStage[stage]?.map((deal) => (
                <div
                  key={deal._id}
                  className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer"
                  onClick={() => {
                    setEditingDeal(deal);
                    setDealForm({
                      title: deal.title,
                      description: deal.description || '',
                      value: deal.value,
                      currency: deal.currency,
                      stage: deal.stage,
                      probability: deal.probability,
                      contact: deal.contact?._id || '',
                      expectedCloseDate: deal.expectedCloseDate
                        ? deal.expectedCloseDate.toString().split('T')[0]
                        : '',
                    });
                    void fetchModalContacts();
                    setShowDealModal(true);
                  }}
                >
                  <h4 className="font-medium text-gray-800 mb-2">
                    {deal.title}
                  </h4>
                  <p className="text-lg font-bold text-green-600">
                    ${deal.value.toLocaleString()}
                  </p>
                  {deal.contact && (
                    <p className="text-sm text-gray-500 mt-2">
                      {deal.contact.firstName} {deal.contact.lastName}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                    <span className="text-xs text-gray-400">
                      {deal.probability}% probability
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDeal(deal._id);
                      }}
                      className="p-1 text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Render Activities
  const renderActivities = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-xl font-bold text-gray-800">Activities & Tasks</h2>
        <button
          onClick={() => {
            resetActivityForm();
            setEditingActivity(null);
            void fetchModalContacts();
            void fetchModalDeals();
            setShowActivityModal(true);
          }}
          className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition"
        >
          <Plus className="h-5 w-5" /> Add Activity
        </button>
      </div>

      {/* Activities List */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="px-6 py-12 text-center text-gray-400">
              Loading...
            </div>
          ) : activities.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400">
              No activities found
            </div>
          ) : (
            activities.map((activity) => (
              <div
                key={activity._id}
                className="p-6 hover:bg-gray-50 transition"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`p-3 rounded-xl ${
                      activity.type === 'call'
                        ? 'bg-blue-100 text-blue-600'
                        : activity.type === 'meeting'
                          ? 'bg-purple-100 text-purple-600'
                          : activity.type === 'email'
                            ? 'bg-green-100 text-green-600'
                            : activity.type === 'whatsapp'
                              ? 'bg-emerald-100 text-emerald-600'
                              : activity.type === 'task'
                                ? 'bg-orange-100 text-orange-600'
                                : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {activity.type === 'call' ? (
                      <Phone className="h-5 w-5" />
                    ) : activity.type === 'meeting' ? (
                      <Calendar className="h-5 w-5" />
                    ) : activity.type === 'email' ? (
                      <Mail className="h-5 w-5" />
                    ) : activity.type === 'whatsapp' ? (
                      <MessageSquare className="h-5 w-5" />
                    ) : (
                      <CheckSquare className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-gray-800">
                        {activity.title}
                      </h4>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          activity.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : activity.status === 'cancelled'
                              ? 'bg-gray-100 text-gray-700'
                              : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {activity.status}
                      </span>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          activity.priority === 'high'
                            ? 'bg-red-100 text-red-700'
                            : activity.priority === 'medium'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {activity.priority}
                      </span>
                    </div>
                    {activity.description && (
                      <p className="text-sm text-gray-500 mt-1">
                        {activity.description}
                      </p>
                    )}
                    {activity.dueDate && (
                      <p className="text-xs text-gray-400 mt-2">
                        Due: {new Date(activity.dueDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {activity.status === 'pending' && (
                      <button
                        onClick={() => handleCompleteActivity(activity._id)}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                        title="Mark Complete"
                      >
                        <CheckCircle className="h-5 w-5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteActivity(activity._id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  // Render Analytics
  const renderAnalytics = () => (
    <div className="space-y-6">
      {/* Header with period selector */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-xl font-bold text-gray-800">Analytics Overview</h2>
        <div className="flex items-center gap-4">
          <select
            value={analyticsPeriod}
            onChange={(e) => setAnalyticsPeriod(e.target.value)}
            className="px-4 py-2 border rounded-lg bg-white"
          >
            <option value="7">Last 7 Days</option>
            <option value="14">Last 14 Days</option>
            <option value="30">Last 30 Days</option>
          </select>
          <button
            onClick={handleExportLeadsCSV}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium shadow-sm hover:bg-indigo-700 transition"
          >
            <Download className="h-4 w-4" /> Export Leads
          </button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Today</p>
              <p className="text-2xl font-bold">
                {analyticsOverview?.todayMessages || 0}
              </p>
            </div>
            <MessageCircle className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">This Week</p>
              <p className="text-2xl font-bold">
                {analyticsOverview?.weekMessages || 0}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Users</p>
              <p className="text-2xl font-bold">
                {analyticsOverview?.totalUsers || 0}
              </p>
            </div>
            <Users className="h-8 w-8 text-purple-500" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Avg/User</p>
              <p className="text-2xl font-bold">
                {analyticsOverview?.avgMessagesPerUser || 0}
              </p>
            </div>
            <BarChart3 className="h-8 w-8 text-orange-500" />
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Message Trends Chart */}
        <div className="bg-white p-5 rounded-xl shadow-md h-80">
          <h3 className="text-lg font-semibold mb-4">Message Trends</h3>
          {messageTrends.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No data available</p>
          ) : (
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart
                data={messageTrends}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="colorMessages"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tickFormatter={(str) => str.slice(5)} />
                <YAxis />
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <RechartsTooltip />
                <Area
                  type="monotone"
                  dataKey="messages"
                  stroke="#3b82f6"
                  fillOpacity={1}
                  fill="url(#colorMessages)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Question Categories */}
        <div className="bg-white p-5 rounded-xl shadow-md h-80">
          <h3 className="text-lg font-semibold mb-4">Question Categories</h3>
          {questionCategories.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No data available</p>
          ) : (
            <ResponsiveContainer width="100%" height="85%">
              <PieChart>
                <Pie
                  data={questionCategories}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="count"
                  nameKey="category"
                  label
                >
                  {questionCategories.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value, name) => [
                    value,
                    getCategoryLabel(name as string),
                  ]}
                />
                <Legend formatter={(value) => getCategoryLabel(value)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top Questions & Message Types */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Questions */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl shadow-md">
          <h3 className="text-lg font-semibold mb-4">Most Common Questions</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {topQuestions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No questions yet</p>
            ) : (
              topQuestions.slice(0, 10).map((q, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                >
                  <span className="text-xs font-medium text-gray-400 w-6">
                    #{idx + 1}
                  </span>
                  <span className="flex-1 text-sm">{q.question}</span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                    {q.count}x
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Message Types */}
        <div className="bg-white p-5 rounded-xl shadow-md">
          <h3 className="text-lg font-semibold mb-4">Message Types</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-blue-600" />
                <span className="font-medium">Text Messages</span>
              </div>
              <span className="text-xl font-bold">
                {analyticsOverview?.textMessages || 0}
              </span>
            </div>
            <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Mic className="h-6 w-6 text-purple-600" />
                <span className="font-medium">Voice Messages</span>
              </div>
              <span className="text-xl font-bold">
                {analyticsOverview?.voiceMessages || 0}
              </span>
            </div>
          </div>

          <div className="mt-6 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Interactions</span>
              <span className="font-medium">
                {analyticsOverview?.totalMessages || 0}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Chatbot Messages</span>
              <span className="font-medium text-blue-600">
                {analyticsOverview?.botMessages || 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Lead Stats Summary */}
      <div className="bg-white p-5 rounded-xl shadow-md">
        <h3 className="text-lg font-semibold mb-4">
          Lead Registrations Summary
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-600">Total Leads</p>
            <p className="text-2xl font-bold">
              {leadAnalyticsStats?.totalLeads || 0}
            </p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <p className="text-sm text-green-600">This Week</p>
            <p className="text-2xl font-bold">
              {leadAnalyticsStats?.weekLeads || 0}
            </p>
          </div>
          <div className="p-4 bg-yellow-50 rounded-lg">
            <p className="text-sm text-yellow-600">New</p>
            <p className="text-2xl font-bold">
              {leadAnalyticsStats?.byStatus?.new || 0}
            </p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg">
            <p className="text-sm text-purple-600">Accepted</p>
            <p className="text-2xl font-bold">
              {leadAnalyticsStats?.byStatus?.accepted || 0}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // Render Leads/Registrations
  const renderLeads = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-4 rounded-xl shadow-lg text-white">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-indigo-100 text-xs font-medium">Total Leads</p>
              <p className="text-2xl font-bold mt-1">
                {registrationStats?.totalLeads || registrationStats?.total || 0}
              </p>
            </div>
            <UserPlus className="h-5 w-5" />
          </div>
        </div>
        {Object.entries(leadStatusConfig).map(([key, config]) => {
          const count = registrationStats?.byStatus?.[key] || 0;
          return (
            <div key={key} className="bg-white p-4 rounded-xl shadow-sm border">
              <p className="text-gray-500 text-xs font-medium">
                {config.label}
              </p>
              <p className="text-xl font-bold mt-1">{count}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border">
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, phone, email..."
              value={registrationSearch}
              onChange={(e) => {
                setRegistrationSearch(e.target.value);
                setRegistrationsPage(1);
              }}
              className="pl-12 pr-4 py-2 w-full bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none"
            />
          </div>
          <div className="flex gap-3">
            <select
              value={registrationStatusFilter}
              onChange={(e) => {
                setRegistrationStatusFilter(e.target.value);
                setRegistrationsPage(1);
              }}
              className="px-4 py-2 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none"
            >
              <option value="">Status: All</option>
              {Object.entries(leadStatusConfig).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.label}
                </option>
              ))}
            </select>
            <select
              value={registrationJobFilter}
              onChange={(e) => {
                setRegistrationJobFilter(e.target.value);
                setRegistrationsPage(1);
              }}
              className="px-4 py-2 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none"
            >
              <option value="">Job: All</option>
              {jobTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            {(registrationSearch ||
              registrationStatusFilter ||
              registrationJobFilter) && (
              <button
                onClick={() => {
                  setRegistrationSearch('');
                  setRegistrationStatusFilter('');
                  setRegistrationJobFilter('');
                  setRegistrationsPage(1);
                }}
                className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            )}
          </div>
          <button
            onClick={handleExportLeadsCSV}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700"
          >
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Lead
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Details
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Job / Country
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  CV
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase">
                  Registered
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-gray-400 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-12 text-center text-gray-400"
                  >
                    Loading...
                  </td>
                </tr>
              ) : registrations.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-12 text-center text-gray-400"
                  >
                    No registrations found
                  </td>
                </tr>
              ) : (
                registrations.map((lead) => (
                  <tr key={lead._id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">
                          {(lead.fullName || 'U').charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">
                            {lead.fullName}
                          </p>
                          <p className="text-xs text-gray-400">
                            Age: {lead.age || 'N/A'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="h-4 w-4 text-indigo-400" />
                        {lead.phoneNumber}
                      </div>
                      {lead.email && (
                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                          <Mail className="h-3 w-3" />
                          {lead.email}
                        </div>
                      )}
                      {lead.experienceYears && (
                        <p className="text-xs text-gray-400 mt-1">
                          Exp: {lead.experienceYears} yrs
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">
                        {lead.jobVacancyType}
                      </span>
                      {lead.interestedCountry && (
                        <p className="text-xs text-gray-500 mt-1">
                          {lead.interestedCountry}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {lead.cvUrl ? (
                        <a
                          href={`${import.meta.env.VITE_API_URL || ''}${
                            lead.cvUrl
                          }`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-green-600 hover:text-green-700"
                        >
                          <FileText className="h-4 w-4" />
                          <span className="text-xs">View CV</span>
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">No CV</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={lead.status}
                        onChange={(e) =>
                          handleRegistrationStatusChange(
                            lead._id,
                            e.target.value,
                          )
                        }
                        className={`text-xs font-medium px-3 py-1 rounded-full border ${
                          leadStatusConfig[
                            lead.status as keyof typeof leadStatusConfig
                          ]?.color
                        }`}
                      >
                        {Object.entries(leadStatusConfig).map(
                          ([key, config]) => (
                            <option
                              key={key}
                              value={key}
                              className="bg-white text-gray-900"
                            >
                              {config.label}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(lead.registeredAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`https://wa.me/${lead.phoneNumber.replace(
                            /[^0-9]/g,
                            '',
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => {
                            setSelectedRegistration(lead);
                            setShowRegistrationModal(true);
                          }}
                          className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteRegistration(lead._id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
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
        {registrationsTotalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-t">
            <p className="text-sm text-gray-500">
              Page {registrationsPage} of {registrationsTotalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setRegistrationsPage((p) => Math.max(1, p - 1))}
                disabled={registrationsPage === 1}
                className="p-2 bg-white rounded-lg border disabled:opacity-30 hover:border-indigo-500"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() =>
                  setRegistrationsPage((p) =>
                    Math.min(registrationsTotalPages, p + 1),
                  )
                }
                disabled={registrationsPage === registrationsTotalPages}
                className="p-2 bg-white rounded-lg border disabled:opacity-30 hover:border-indigo-500"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Registration Detail Modal */}
      {showRegistrationModal && selectedRegistration && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xl font-bold">
                  {(selectedRegistration.fullName || 'U').charAt(0)}
                </div>
                <div>
                  <h3 className="text-xl font-bold">
                    {selectedRegistration.fullName}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {selectedRegistration.jobVacancyType}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRegistrationModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: Personal Info */}
              <div className="space-y-4">
                <h4 className="font-bold text-gray-800 flex items-center gap-2">
                  <Users className="h-4 w-4" /> Personal Information
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 p-3 rounded-xl">
                    <p className="text-xs text-gray-400 mb-1">Age</p>
                    <p className="font-medium">
                      {selectedRegistration.age || 'N/A'}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl">
                    <p className="text-xs text-gray-400 mb-1">Phone</p>
                    <p className="font-medium">
                      {selectedRegistration.phoneNumber}
                    </p>
                  </div>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Email</p>
                  <p className="font-medium">
                    {selectedRegistration.email || 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Address</p>
                  <p className="font-medium">
                    {selectedRegistration.address || 'N/A'}
                  </p>
                </div>

                <h4 className="font-bold text-gray-800 flex items-center gap-2 pt-2">
                  <Briefcase className="h-4 w-4" /> Job Details
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-indigo-50 p-3 rounded-xl">
                    <p className="text-xs text-indigo-400 mb-1">Job Category</p>
                    <p className="font-medium">
                      {selectedRegistration.jobVacancyType}
                    </p>
                  </div>
                  <div className="bg-indigo-50 p-3 rounded-xl">
                    <p className="text-xs text-indigo-400 mb-1">Country</p>
                    <p className="font-medium">
                      {selectedRegistration.interestedCountry || 'N/A'}
                    </p>
                  </div>
                </div>
                <div className="bg-indigo-50 p-3 rounded-xl">
                  <p className="text-xs text-indigo-400 mb-1">Experience</p>
                  <p className="font-medium">
                    {selectedRegistration.experienceYears
                      ? `${selectedRegistration.experienceYears} years`
                      : 'N/A'}
                  </p>
                </div>

                <div className="bg-purple-50 p-4 rounded-xl">
                  <p className="text-xs text-purple-400 mb-1">Status</p>
                  <select
                    value={selectedRegistration.status}
                    onChange={async (e) => {
                      await handleRegistrationStatusChange(
                        selectedRegistration._id,
                        e.target.value,
                      );
                      setSelectedRegistration({
                        ...selectedRegistration,
                        status: e.target.value as LeadRegistration['status'],
                      });
                    }}
                    className={`w-full font-medium px-4 py-2 rounded-xl ${
                      leadStatusConfig[
                        selectedRegistration.status as keyof typeof leadStatusConfig
                      ]?.color
                    }`}
                  >
                    {Object.entries(leadStatusConfig).map(([key, config]) => (
                      <option
                        key={key}
                        value={key}
                        className="bg-white text-gray-900"
                      >
                        {config.label}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedRegistration.notes && (
                  <div className="bg-yellow-50 p-3 rounded-xl">
                    <p className="text-xs text-yellow-600 mb-1">Notes</p>
                    <p className="font-medium text-sm">
                      {selectedRegistration.notes}
                    </p>
                  </div>
                )}
              </div>

              {/* Right: CV & Documents */}
              <div className="space-y-4">
                <h4 className="font-bold text-gray-800 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> CV / Resume
                </h4>
                {selectedRegistration.cvUrl ? (
                  <div className="bg-green-50 border border-green-200 p-4 rounded-xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded-lg">
                          <FileText className="h-6 w-6 text-green-600" />
                        </div>
                        <div>
                          <p className="font-medium text-green-800">
                            {selectedRegistration.cvFileName || 'CV Document'}
                          </p>
                          <p className="text-xs text-green-600">
                            Uploaded:{' '}
                            {selectedRegistration.cvUploadedAt
                              ? new Date(
                                  selectedRegistration.cvUploadedAt,
                                ).toLocaleDateString()
                              : 'N/A'}
                          </p>
                        </div>
                      </div>
                      <a
                        href={`${import.meta.env.VITE_API_URL || ''}${
                          selectedRegistration.cvUrl
                        }`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        <Download className="h-4 w-4" /> View
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                    <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No CV uploaded</p>
                  </div>
                )}

                {/* Upload CV */}
                <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-indigo-200 rounded-xl cursor-pointer hover:bg-indigo-50/30 transition">
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        handleQualificationUpload(
                          selectedRegistration._id,
                          file,
                        );
                    }}
                    disabled={uploadingQualification}
                    className="hidden"
                  />
                  <Upload className="h-6 w-6 text-indigo-400 mb-2" />
                  <span className="text-sm text-indigo-600 font-medium">
                    {uploadingQualification
                      ? 'Uploading...'
                      : 'Upload CV / Document'}
                  </span>
                  <span className="text-xs text-gray-400 mt-1">
                    PDF, DOC, DOCX, JPG, PNG
                  </span>
                </label>

                {/* Qualifications */}
                {selectedRegistration.qualifications &&
                  selectedRegistration.qualifications.length > 0 && (
                    <>
                      <h4 className="font-bold text-gray-800 pt-2">
                        Other Documents
                      </h4>
                      {selectedRegistration.qualifications.map((qual, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 bg-white border rounded-xl"
                        >
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-orange-500" />
                            <div>
                              <p className="font-medium text-sm">
                                {qual.fileName}
                              </p>
                              <p className="text-xs text-gray-400">
                                {(qual.fileSize / 1024).toFixed(1)} KB
                              </p>
                            </div>
                          </div>
                          <a
                            href={`${import.meta.env.VITE_API_URL || ''}${
                              qual.filePath
                            }`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-gray-100 rounded-lg"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </div>
                      ))}
                    </>
                  )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <a
                href={`https://wa.me/${selectedRegistration.phoneNumber.replace(
                  /[^0-9]/g,
                  '',
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-medium"
              >
                <MessageSquare className="h-5 w-5" /> WhatsApp
              </a>
              <button
                onClick={() => setShowRegistrationModal(false)}
                className="px-6 py-3 border border-gray-200 rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {registrationNotification && (
        <div
          className={`fixed bottom-8 right-8 flex items-center gap-3 px-6 py-4 rounded-xl shadow-lg z-[100] ${
            registrationNotification.type === 'success'
              ? 'bg-green-600 text-white'
              : registrationNotification.type === 'error'
                ? 'bg-red-600 text-white'
                : 'bg-indigo-600 text-white'
          }`}
        >
          {registrationNotification.type === 'success' ? (
            <CheckCircle className="h-5 w-5" />
          ) : registrationNotification.type === 'error' ? (
            <AlertCircle className="h-5 w-5" />
          ) : (
            <FileText className="h-5 w-5" />
          )}
          <p className="font-medium text-sm">
            {registrationNotification.message}
          </p>
          <button
            onClick={() => setRegistrationNotification(null)}
            className="ml-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="animate-in fade-in duration-500">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">CRM</h1>
          <p className="text-gray-500 mt-1">
            Manage contacts, deals, and activities
            {sessionFilter !== 'all' && (
              <span className="ml-2 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                Filtered to one device
              </span>
            )}
          </p>
        </div>
        {/* Per-device picker — only renders when more than one session is
            connected. Matches the device-tab pattern on the Chat page. */}
        {sessions.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Device
            </span>
            <select
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg bg-white"
            >
              <option value="all">All devices ({sessions.length})</option>
              {sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.sessionName || s.sessionId}
                  {s.status && s.status !== 'connected'
                    ? ` (${s.status})`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'analytics' && renderAnalytics()}
      {activeTab === 'contacts' && renderContacts()}
      {activeTab === 'deals' && renderDeals()}
      {activeTab === 'leads' && renderLeads()}
      {activeTab === 'activities' && renderActivities()}

      {/* Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">
                {editingContact ? 'Edit Contact' : 'Add Contact'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="First Name"
                  value={contactForm.firstName}
                  onChange={(e) =>
                    setContactForm({
                      ...contactForm,
                      firstName: e.target.value,
                    })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={contactForm.lastName}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, lastName: e.target.value })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <input
                type="email"
                placeholder="Email"
                value={contactForm.email}
                onChange={(e) =>
                  setContactForm({ ...contactForm, email: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <input
                type="text"
                placeholder="Phone"
                value={contactForm.phone}
                onChange={(e) =>
                  setContactForm({ ...contactForm, phone: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <input
                type="text"
                placeholder="Company"
                value={contactForm.company}
                onChange={(e) =>
                  setContactForm({ ...contactForm, company: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <div className="grid grid-cols-2 gap-4">
                <select
                  value={contactForm.type}
                  onChange={(e) =>
                    setContactForm({
                      ...contactForm,
                      type: e.target.value as Contact['type'],
                    })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="lead">Lead</option>
                  <option value="prospect">Prospect</option>
                  <option value="customer">Customer</option>
                  <option value="partner">Partner</option>
                  <option value="vendor">Vendor</option>
                </select>
                <select
                  value={contactForm.source}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, source: e.target.value })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="website">Website</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="referral">Referral</option>
                  <option value="social_media">Social Media</option>
                  <option value="cold_call">Cold Call</option>
                  <option value="event">Event</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <input
                type="text"
                placeholder="Tags (comma separated)"
                value={contactForm.tags}
                onChange={(e) =>
                  setContactForm({ ...contactForm, tags: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <textarea
                placeholder="Notes"
                value={contactForm.notes}
                onChange={(e) =>
                  setContactForm({ ...contactForm, notes: e.target.value })
                }
                rows={3}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowContactModal(false)}
                className="px-6 py-3 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveContact}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition"
              >
                {editingContact ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deal Modal */}
      {showDealModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">
                {editingDeal ? 'Edit Deal' : 'Add Deal'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <input
                type="text"
                placeholder="Deal Title"
                value={dealForm.title}
                onChange={(e) =>
                  setDealForm({ ...dealForm, title: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
              />
              <textarea
                placeholder="Description"
                value={dealForm.description}
                onChange={(e) =>
                  setDealForm({ ...dealForm, description: e.target.value })
                }
                rows={2}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none resize-none"
              />
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="number"
                  placeholder="Value"
                  value={dealForm.value}
                  onChange={(e) =>
                    setDealForm({ ...dealForm, value: Number(e.target.value) })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                />
                <select
                  value={dealForm.currency}
                  onChange={(e) =>
                    setDealForm({ ...dealForm, currency: e.target.value })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="LKR">LKR</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <select
                  value={dealForm.stage}
                  onChange={(e) =>
                    setDealForm({
                      ...dealForm,
                      stage: e.target.value as Deal['stage'],
                    })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option value="new">New</option>
                  <option value="qualified">Qualified</option>
                  <option value="proposal">Proposal</option>
                  <option value="negotiation">Negotiation</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
                <input
                  type="number"
                  placeholder="Probability %"
                  value={dealForm.probability}
                  onChange={(e) =>
                    setDealForm({
                      ...dealForm,
                      probability: Number(e.target.value),
                    })
                  }
                  min={0}
                  max={100}
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>
              {/* Contact picker */}
              <select
                value={dealForm.contact}
                onChange={(e) =>
                  setDealForm({ ...dealForm, contact: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
              >
                <option value="">— No contact linked —</option>
                {modalContacts.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.firstName} {c.lastName}
                    {c.company ? ` (${c.company})` : ''}
                  </option>
                ))}
              </select>
              <input
                type="date"
                placeholder="Expected Close Date"
                value={dealForm.expectedCloseDate}
                onChange={(e) =>
                  setDealForm({
                    ...dealForm,
                    expectedCloseDate: e.target.value,
                  })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowDealModal(false)}
                className="px-6 py-3 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDeal}
                className="px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 transition"
              >
                {editingDeal ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activity Modal */}
      {showActivityModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">
                {editingActivity ? 'Edit Activity' : 'Add Activity'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <select
                value={activityForm.type}
                onChange={(e) =>
                  setActivityForm({
                    ...activityForm,
                    type: e.target.value as ActivityItem['type'],
                  })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
              >
                <option value="task">Task</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="note">Note</option>
              </select>
              <input
                type="text"
                placeholder="Title"
                value={activityForm.title}
                onChange={(e) =>
                  setActivityForm({ ...activityForm, title: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <textarea
                placeholder="Description"
                value={activityForm.description}
                onChange={(e) =>
                  setActivityForm({
                    ...activityForm,
                    description: e.target.value,
                  })
                }
                rows={3}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none resize-none"
              />
              {/* Contact picker */}
              <select
                value={activityForm.contact}
                onChange={(e) =>
                  setActivityForm({ ...activityForm, contact: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
              >
                <option value="">— No contact linked —</option>
                {modalContacts.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.firstName} {c.lastName}
                    {c.company ? ` (${c.company})` : ''}
                  </option>
                ))}
              </select>
              {/* Deal picker */}
              <select
                value={activityForm.deal}
                onChange={(e) =>
                  setActivityForm({ ...activityForm, deal: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
              >
                <option value="">— No deal linked —</option>
                {modalDeals.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.title}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-4">
                <select
                  value={activityForm.priority}
                  onChange={(e) =>
                    setActivityForm({
                      ...activityForm,
                      priority: e.target.value as ActivityItem['priority'],
                    })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                </select>
                <input
                  type="date"
                  placeholder="Due Date"
                  value={activityForm.dueDate}
                  onChange={(e) =>
                    setActivityForm({
                      ...activityForm,
                      dueDate: e.target.value,
                    })
                  }
                  className="px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowActivityModal(false)}
                className="px-6 py-3 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveActivity}
                className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition"
              >
                {editingActivity ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
