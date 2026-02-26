import { useState, useEffect } from 'react';
import { api } from '../config';
import {
  MessageCircle, Users, TrendingUp, BarChart3,
  FileText, Mic, Download, Bot
} from 'lucide-react';

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
  metadata?: any;
}

export default function Analytics() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [questions, setQuestions] = useState<QuestionCategory[]>([]);
  const [topQuestions, setTopQuestions] = useState<TopQuestion[]>([]);
  const [recentReplies, setRecentReplies] = useState<ChatbotReply[]>([]);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [leadStats, setLeadStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState('7');

  useEffect(() => {
    fetchData();
  }, [selectedPeriod]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [overviewRes, questionsRes, topRes, trendsRes, leadsRes, repliesRes] = await Promise.all([
        api.get('/api/analytics/overview'),
        api.get('/api/analytics/questions'),
        api.get('/api/analytics/top-questions?limit=15'),
        api.get(`/api/analytics/trends?days=${selectedPeriod}`),
        api.get('/api/analytics/leads'),
        api.get('/api/analytics/recent-replies?limit=10')
      ]);

      setOverview(overviewRes.data);
      setQuestions(questionsRes.data.categories);
      setTopQuestions(topRes.data);
      setTrends(trendsRes.data);
      setLeadStats(leadsRes.data);
      setRecentReplies(repliesRes.data);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
    }
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
    } catch (err) {
      console.error('Failed to export CSV', err);
      alert('Failed to export CSV. Please try again later.');
    }
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
      language: 'Language'
    };
    return labels[cat] || cat;
  };

  const getCategoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      jobs: 'bg-blue-500',
      register: 'bg-green-500',
      payment: 'bg-yellow-500',
      booking: 'bg-purple-500',
      location: 'bg-red-500',
      services: 'bg-indigo-500',
      hello: 'bg-pink-500',
      language: 'bg-cyan-500'
    };
    return colors[cat] || 'bg-gray-500';
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="text-gray-500">Loading analytics...</span></div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
        <div className="flex items-center gap-4">
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="7">Last 7 Days</option>
            <option value="14">Last 14 Days</option>
            <option value="30">Last 30 Days</option>
          </select>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium shadow-sm hover:bg-indigo-700 transition"
          >
            <Download className="h-4 w-4" /> Export Leads CSV
          </button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-5 rounded-xl shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Today</p>
              <p className="text-2xl font-bold">{overview?.todayMessages || 0}</p>
            </div>
            <MessageCircle className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">This Week</p>
              <p className="text-2xl font-bold">{overview?.weekMessages || 0}</p>
            </div>
            <TrendingUp className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Users</p>
              <p className="text-2xl font-bold">{overview?.totalUsers || 0}</p>
            </div>
            <Users className="h-8 w-8 text-purple-500" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Avg/User</p>
              <p className="text-2xl font-bold">{overview?.avgMessagesPerUser || 0}</p>
            </div>
            <BarChart3 className="h-8 w-8 text-orange-500" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Message Trends Chart */}
        <div className="bg-white p-5 rounded-xl shadow-md">
          <h2 className="text-lg font-semibold mb-4">Message Trends</h2>
          <div className="space-y-3">
            {trends.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No data available</p>
            ) : (
              (() => {
                const maxMessages = Math.max(...trends.map(t => t.messages), 1);
                return trends.map((day) => (
                  <div key={day.date} className="flex items-center gap-4">
                    <span className="text-sm text-gray-500 w-20">{day.date.slice(5)}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="bg-blue-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, (day.messages / maxMessages) * 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-12 text-right">{day.messages}</span>
                  </div>
                ));
              })()
            )}
          </div>
        </div>

        {/* Question Categories */}
        <div className="bg-white p-5 rounded-xl shadow-md">
          <h2 className="text-lg font-semibold mb-4">Question Categories</h2>
          <div className="space-y-3">
            {questions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No data available</p>
            ) : (
              questions.map((q) => (
                <div key={q.category} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${getCategoryColor(q.category)}`} />
                  <span className="flex-1 text-sm">{getCategoryLabel(q.category)}</span>
                  <span className="text-sm font-medium">{q.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Top Questions */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl shadow-md">
          <h2 className="text-lg font-semibold mb-4">Most Common Questions</h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {topQuestions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No questions yet</p>
            ) : (
              topQuestions.map((q, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xs font-medium text-gray-400 w-6">#{idx + 1}</span>
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
          <h2 className="text-lg font-semibold mb-4">Message Types</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-blue-600" />
                <span className="font-medium">Text Messages</span>
              </div>
              <span className="text-xl font-bold">{overview?.textMessages || 0}</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Mic className="h-6 w-6 text-purple-600" />
                <span className="font-medium">Voice Messages Replied</span>
              </div>
              <span className="text-xl font-bold">{overview?.voiceMessages || 0}</span>
            </div>
          </div>

          <h2 className="text-lg font-semibold mt-6 mb-4">Total Stats</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Interactions</span>
              <span className="font-medium">{overview?.totalMessages || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Chatbot Messages Sent</span>
              <span className="font-medium text-blue-600">{overview?.botMessages || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Questions Asked</span>
              <span className="font-medium text-purple-600">{overview?.userMessages || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">This Month</span>
              <span className="font-medium">{overview?.monthMessages || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Chatbot Replies */}
      <div className="bg-white p-5 rounded-xl shadow-md mb-6">
        <h2 className="text-lg font-semibold mb-4">Recent Chatbot Replies</h2>
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
          {recentReplies.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No recent replies</p>
          ) : (
            recentReplies.map((reply) => (
              <div key={reply.id} className="p-4 bg-gray-50 rounded-lg border border-gray-100 flex gap-4">
                <div className="flex-shrink-0 mt-1">
                  <Bot className="h-6 w-6 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      AI Assistant
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(reply.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{reply.content}</p>
                  {reply.metadata?.intent && reply.metadata.intent !== 'General' && (
                    <div className="mt-2 flex gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                        {reply.metadata.intent}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Leads Section */}
      <div className="bg-white p-5 rounded-xl shadow-md mb-6">
        <h2 className="text-lg font-semibold mb-4">Lead Registrations</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-600">Total Leads</p>
            <p className="text-2xl font-bold">{leadStats?.totalLeads || 0}</p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <p className="text-sm text-green-600">This Week</p>
            <p className="text-2xl font-bold">{leadStats?.weekLeads || 0}</p>
          </div>
          <div className="p-4 bg-yellow-50 rounded-lg">
            <p className="text-sm text-yellow-600">New</p>
            <p className="text-2xl font-bold">{leadStats?.byStatus?.new || 0}</p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg">
            <p className="text-sm text-purple-600">Accepted</p>
            <p className="text-2xl font-bold">{leadStats?.byStatus?.accepted || 0}</p>
          </div>
        </div>

        {leadStats?.byJobType && Object.keys(leadStats.byJobType).length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-gray-500 mb-2">By Job Type</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(leadStats.byJobType).map(([type, count]) => (
                <span key={type} className="px-3 py-1 bg-gray-100 rounded-full text-sm">
                  {type}: <strong>{count}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
