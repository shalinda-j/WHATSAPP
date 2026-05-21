import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../config';
import { io, Socket } from 'socket.io-client';
import {
  Search, Send, MoreVertical, Phone, ChevronLeft,
  CheckCheck, Circle, Bot, User, Mic, Smile, Languages,
  Tag, Globe, Info, X, RefreshCw, MessageSquare, Download,
  Calendar as CalendarIcon, ArrowDown, ArrowUp, Activity,
  CheckCircle2, AlertCircle
} from 'lucide-react';

type ExportSort = 'newest' | 'oldest' | 'active';
type ExportRole = 'all' | 'user' | 'assistant';
type ExportFormat = 'csv' | 'json';

interface ExportPreview {
  uniqueContacts: number;
  totalMessages: number;
  totalChatMessages?: number;
  mostRecent: string | null;
  diagnostics?: {
    uniqueUserIdsInChat: number;
    fromChatHistory: number;
    fromLeads: number;
    fromContacts: number;
    rejectedGroupSamples: string[];
    rejectedOtherSamples: string[];
  };
}

interface Message {
  _id: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'voice' | 'image' | 'document';
  content: string;
  timestamp: Date;
  language?: string;
  metadata?: {
    intent?: string;
    buyingSignal?: string;
    isBooking?: boolean;
    detectedLanguage?: string;
  };
}

interface Conversation {
  userId: string;
  lastMessage?: Message;
  unreadCount: number;
  detectedLanguage?: string;
  userInfo?: {
    name?: string;
    phone?: string;
  };
}

type ToneMode = 'auto' | 'formal' | 'casual' | 'professional' | 'friendly';
type LangFilter = 'all' | 'en' | 'si' | 'ta';

const LANG_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  en: { label: 'EN', color: 'text-blue-700', bg: 'bg-blue-100' },
  si: { label: 'SI', color: 'text-purple-700', bg: 'bg-purple-100' },
  ta: { label: 'TA', color: 'text-orange-700', bg: 'bg-orange-100' },
};

const TONE_MODES: { value: ToneMode; label: string; desc: string }[] = [
  { value: 'auto', label: '🤖 Auto', desc: 'AI chooses tone automatically' },
  { value: 'formal', label: '👔 Formal', desc: 'Professional, polished tone' },
  { value: 'casual', label: '😊 Casual', desc: 'Relaxed, friendly conversation' },
  { value: 'professional', label: '💼 Professional', desc: 'Business-focused responses' },
  { value: 'friendly', label: '🤝 Friendly', desc: 'Warm, approachable style' },
];

function detectLanguage(text: string): string {
  if (!text) return 'en';
  if (/[\u0D80-\u0DFF]/.test(text)) return 'si';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  return 'en';
}

export default function ChatInterface() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [langFilter, setLangFilter] = useState<LangFilter>('all');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [, setSocket] = useState<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [toneMode, setToneMode] = useState<ToneMode>('auto');
  const [showToneMenu, setShowToneMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportToast, setExportToast] = useState<{
    msg: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportSort, setExportSort] = useState<ExportSort>('newest');
  const [exportRole, setExportRole] = useState<ExportRole>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [includeLeads, setIncludeLeads] = useState(true);
  const [includeContacts, setIncludeContacts] = useState(true);
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Detect language of the message being typed
  const typingLang = detectLanguage(newMessage);

  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || window.location.origin;
    const token = localStorage.getItem('token');
    const newSocket = io(API_URL, {
      transports: ['websocket', 'polling'],
      auth: { token },
    });

    newSocket.on('connect', () => console.log('WebSocket connected'));

    newSocket.on('new-message', (data: Message) => {
      const lang = detectLanguage(data.content);
      const enriched = { ...data, language: lang };

      if (selectedUser === data.userId) {
        setMessages(prev => [...prev, enriched]);
      }
      setConversations(prev => {
        const existing = prev.find(c => c.userId === data.userId);
        if (existing) {
          return prev.map(c => c.userId === data.userId
            ? { ...c, lastMessage: enriched, unreadCount: c.userId !== selectedUser ? c.unreadCount + 1 : 0, detectedLanguage: lang }
            : c
          ).sort((a, b) => new Date(b.lastMessage?.timestamp || 0).getTime() - new Date(a.lastMessage?.timestamp || 0).getTime());
        } else {
          return [{ userId: data.userId, lastMessage: enriched, unreadCount: 1, detectedLanguage: lang }, ...prev];
        }
      });
    });

    newSocket.on('messages-read', (data: { userId: string }) => {
      setConversations(prev => prev.map(c => c.userId === data.userId ? { ...c, unreadCount: 0 } : c));
    });

    setSocket(newSocket);
    return () => { newSocket.disconnect(); };
  }, [selectedUser]);

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/chat/conversations');
      const convs = (res.data.conversations || []).map((c: Conversation) => ({
        ...c,
        detectedLanguage: c.lastMessage ? detectLanguage(c.lastMessage.content) : 'en',
      }));
      setConversations(convs);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (userId: string) => {
    setIsRefreshing(true);
    try {
      const res = await api.get(`/api/chat/messages/${encodeURIComponent(userId)}`);
      const msgs = (res.data.messages || []).map((m: Message) => ({
        ...m,
        language: m.metadata?.detectedLanguage || detectLanguage(m.content),
      }));
      setMessages(msgs);
      try {
        await api.post(`/api/chat/mark-read/${encodeURIComponent(userId)}`);
        setConversations(prev => prev.map(c => c.userId === userId ? { ...c, unreadCount: 0 } : c));
      } catch { /* ignore mark read errors */ }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      setMessages([]);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => { fetchConversations(); }, []);

  useEffect(() => {
    if (selectedUser) fetchMessages(selectedUser);
  }, [selectedUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedUser || sending) return;

    const msgLang = detectLanguage(newMessage);
    setSending(true);
    try {
      await api.post('/api/chat/send', {
        userId: selectedUser,
        message: newMessage.trim(),
        tone: toneMode !== 'auto' ? toneMode : undefined,
        language: msgLang,
      });
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  const fetchExportPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await api.get('/api/chat/export-numbers/preview');
      setExportPreview(res.data);
    } catch (e) {
      console.error('Preview failed', e);
      setExportPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setExportToast({ msg, type });
    setTimeout(() => setExportToast(null), 4000);
  };

  const handleExportNumbers = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params = {
        format: exportFormat,
        sort: exportSort,
        role: exportRole,
        includeStats: 'true',
        includeLeads: includeLeads ? 'true' : 'false',
        includeContacts: includeContacts ? 'true' : 'false',
      };

      const res = await api.get('/api/chat/export-numbers', {
        responseType: exportFormat === 'csv' ? 'blob' : 'json',
        params,
      });

      const total = Number(res.headers?.['x-export-total']) || undefined;
      const stamp = new Date().toISOString().split('T')[0];

      if (exportFormat === 'json') {
        // res.data is the parsed object — convert to a blob ourselves
        const json = JSON.stringify(res.data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `live-chat-numbers-${stamp}.json`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        const count = (res.data?.contacts || []).length;
        if (count === 0) {
          showToast(
            'No real customer numbers found yet — chat with a customer first, then re-export.',
            'info',
          );
        } else {
          showToast(`Exported ${count} real customer number${count !== 1 ? 's' : ''} (JSON).`, 'success');
        }
      } else {
        const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `live-chat-numbers-${exportSort}-${stamp}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        if (total === 0) {
          showToast(
            'CSV downloaded, but no real customer numbers were found yet. Chat with a customer first, then re-export.',
            'info',
          );
        } else if (typeof total === 'number') {
          showToast(
            `Exported ${total} real customer number${total !== 1 ? 's' : ''} (${exportSort}).`,
            'success',
          );
        } else {
          showToast('Real customer mobile numbers exported successfully.', 'success');
        }
      }

      setShowExportMenu(false);
    } catch (error) {
      console.error('Failed to export numbers:', error);
      showToast('Failed to export numbers. Please try again.', 'error');
    } finally {
      setExporting(false);
    }
  };

  // Refresh preview whenever the export menu opens
  useEffect(() => {
    if (showExportMenu) fetchExportPreview();
  }, [showExportMenu, fetchExportPreview]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date | string) =>
    new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return formatTime(d);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getUserDisplayName = (userId: string) => {
    const phone = userId.split('@')[0];
    const conv = conversations.find(c => c.userId === userId);
    return conv?.userInfo?.name || conv?.userInfo?.phone || `+${phone}`;
  };

  const filteredConversations = conversations.filter(c => {
    const matchSearch = c.userId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.userInfo?.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchLang = langFilter === 'all' || c.detectedLanguage === langFilter;
    return matchSearch && matchLang;
  });

  const selectedConv = conversations.find(c => c.userId === selectedUser);

  const currentToneInfo = TONE_MODES.find(t => t.value === toneMode);

  return (
    <div className="flex h-[calc(100vh-100px)] bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">
      {/* Left Sidebar */}
      <div className={`${showMobileChat ? 'hidden md:flex' : 'flex'} w-full md:w-80 flex-col border-r border-gray-200 bg-gray-50`}>

        {/* Header */}
        <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-600" />
              Live Chat
            </h1>
            <div className="flex items-center gap-2 relative">
              <button
                onClick={() => setShowExportMenu(v => !v)}
                title="Export real customer mobile numbers"
                className={`p-1.5 rounded-lg transition-colors ${
                  showExportMenu
                    ? 'bg-green-100 text-green-700'
                    : 'hover:bg-green-50 text-green-600'
                }`}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button onClick={fetchConversations} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {conversations.length}
              </span>

              {/* Export Options Popover */}
              {showExportMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 z-50 w-[340px] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 bg-gradient-to-br from-green-600 to-emerald-600 text-white">
                      <div className="flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        <h3 className="text-sm font-semibold">Export Real Mobile Numbers</h3>
                      </div>
                      <p className="text-[11px] text-green-100 mt-1">
                        From actual WhatsApp conversations — never random data.
                      </p>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Preview stats */}
                      <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                        {previewLoading ? (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <div className="h-3 w-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                            Counting numbers...
                          </div>
                        ) : exportPreview ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                                Real numbers found
                              </span>
                              <span className="text-base font-bold text-green-700">
                                {exportPreview.uniqueContacts.toLocaleString()}
                              </span>
                            </div>

                            {/* Breakdown by source */}
                            {exportPreview.diagnostics && (
                              <div className="grid grid-cols-3 gap-1 mt-1.5 mb-1">
                                <div className="bg-white border border-gray-200 rounded-md px-1.5 py-1 text-center">
                                  <div className="text-[9px] font-semibold text-gray-400 uppercase">Chat</div>
                                  <div className="text-xs font-bold text-gray-800">
                                    {exportPreview.diagnostics.fromChatHistory.toLocaleString()}
                                  </div>
                                </div>
                                <div className="bg-white border border-gray-200 rounded-md px-1.5 py-1 text-center">
                                  <div className="text-[9px] font-semibold text-gray-400 uppercase">Leads</div>
                                  <div className="text-xs font-bold text-gray-800">
                                    {exportPreview.diagnostics.fromLeads.toLocaleString()}
                                  </div>
                                </div>
                                <div className="bg-white border border-gray-200 rounded-md px-1.5 py-1 text-center">
                                  <div className="text-[9px] font-semibold text-gray-400 uppercase">CRM</div>
                                  <div className="text-xs font-bold text-gray-800">
                                    {exportPreview.diagnostics.fromContacts.toLocaleString()}
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="flex items-center justify-between text-[11px] text-gray-500">
                              <span>Total messages</span>
                              <span className="font-medium text-gray-700">
                                {exportPreview.totalMessages.toLocaleString()}
                              </span>
                            </div>
                            {exportPreview.mostRecent && (
                              <div className="flex items-center justify-between text-[11px] text-gray-500">
                                <span>Most recent</span>
                                <span className="font-medium text-gray-700">
                                  {new Date(exportPreview.mostRecent).toLocaleDateString(undefined, {
                                    month: 'short', day: 'numeric', year: 'numeric',
                                  })}
                                </span>
                              </div>
                            )}
                            {exportPreview.uniqueContacts === 0 && (
                              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1.5 flex items-start gap-1.5">
                                <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                {exportPreview.diagnostics?.uniqueUserIdsInChat === 0
                                  ? 'No customer messages saved yet. Send or receive a WhatsApp message, then re-export.'
                                  : 'Chat history exists but no valid mobile numbers found in it. Check the diagnostics.'}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">Could not load preview.</p>
                        )}
                      </div>

                      {/* Sort options */}
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">
                          Sort by date
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([
                            { v: 'newest', label: 'Newest', icon: ArrowDown },
                            { v: 'oldest', label: 'Oldest', icon: ArrowUp },
                            { v: 'active', label: 'Most active', icon: Activity },
                          ] as { v: ExportSort; label: string; icon: typeof CalendarIcon }[]).map(({ v, label, icon: Icon }) => (
                            <button
                              key={v}
                              onClick={() => setExportSort(v)}
                              className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-[11px] font-medium transition ${
                                exportSort === v
                                  ? 'bg-green-50 border-green-300 text-green-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Role filter */}
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">
                          Include contacts who
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([
                            { v: 'all', label: 'Any chat' },
                            { v: 'user', label: 'Messaged us' },
                            { v: 'assistant', label: 'We messaged' },
                          ] as { v: ExportRole; label: string }[]).map(({ v, label }) => (
                            <button
                              key={v}
                              onClick={() => setExportRole(v)}
                              className={`py-1.5 rounded-lg border text-[11px] font-medium transition ${
                                exportRole === v
                                  ? 'bg-green-50 border-green-300 text-green-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Format toggle */}
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">
                          Format
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(['csv', 'json'] as ExportFormat[]).map(f => (
                            <button
                              key={f}
                              onClick={() => setExportFormat(f)}
                              className={`py-1.5 rounded-lg border text-[11px] font-bold uppercase transition ${
                                exportFormat === f
                                  ? 'bg-green-50 border-green-300 text-green-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                              }`}
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Extra sources */}
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">
                          Also include
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => setIncludeLeads(v => !v)}
                            className={`py-1.5 rounded-lg border text-[11px] font-medium transition ${
                              includeLeads
                                ? 'bg-green-50 border-green-300 text-green-700'
                                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                          >
                            {includeLeads ? '✓ ' : ''}Registered Leads
                          </button>
                          <button
                            onClick={() => setIncludeContacts(v => !v)}
                            className={`py-1.5 rounded-lg border text-[11px] font-medium transition ${
                              includeContacts
                                ? 'bg-green-50 border-green-300 text-green-700'
                                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                          >
                            {includeContacts ? '✓ ' : ''}CRM Contacts
                          </button>
                        </div>
                      </div>

                      {/* Download button */}
                      <button
                        onClick={handleExportNumbers}
                        disabled={exporting || (exportPreview?.uniqueContacts === 0)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        {exporting ? (
                          <>
                            <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Exporting...
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            Download {exportFormat.toUpperCase()}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Language Filter */}
          <div className="flex gap-1">
            {(['all', 'en', 'si', 'ta'] as LangFilter[]).map(l => (
              <button
                key={l}
                onClick={() => setLangFilter(l)}
                className={`flex-1 py-1 text-[10px] font-semibold rounded uppercase transition-colors ${
                  langFilter === l
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {l === 'all' ? 'All' : l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-green-500"></div>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400">
              <MessageSquare className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">No conversations</p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const lang = conv.detectedLanguage;
              const langInfo = lang ? LANG_LABELS[lang] : null;
              return (
                <div
                  key={conv.userId}
                  onClick={() => {
                    setSelectedUser(conv.userId);
                    setShowMobileChat(true);
                    setConversations(prev => prev.map(c => c.userId === conv.userId ? { ...c, unreadCount: 0 } : c));
                  }}
                  className={`flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors border-b border-gray-100 ${
                    selectedUser === conv.userId
                      ? 'bg-green-50 border-l-4 border-l-green-500'
                      : 'hover:bg-gray-100 border-l-4 border-l-transparent'
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-bold text-base shadow-sm">
                      {getUserDisplayName(conv.userId).charAt(0).toUpperCase()}
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold shadow">
                        {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className="font-semibold text-gray-900 truncate text-sm">
                        {getUserDisplayName(conv.userId)}
                      </h3>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                        {langInfo && (
                          <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${langInfo.bg} ${langInfo.color}`}>
                            {langInfo.label}
                          </span>
                        )}
                        {conv.lastMessage && (
                          <span className="text-[10px] text-gray-400">{formatDate(conv.lastMessage.timestamp)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {conv.lastMessage?.role === 'assistant' && (
                        <CheckCheck className="h-3 w-3 text-blue-400 flex-shrink-0" />
                      )}
                      <p className="text-xs text-gray-500 truncate">
                        {conv.lastMessage?.content || 'No messages yet'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Panel - Chat Area */}
      <div className={`${showMobileChat ? 'flex' : 'hidden md:flex'} flex-1 flex-col`}>

        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm flex items-center gap-3">
              <button onClick={() => setShowMobileChat(false)} className="md:hidden p-1.5 hover:bg-gray-100 rounded-lg">
                <ChevronLeft className="h-5 w-5 text-gray-600" />
              </button>

              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-bold text-sm">
                {getUserDisplayName(selectedUser).charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-gray-900 text-sm">{getUserDisplayName(selectedUser)}</h2>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <Circle className="h-1.5 w-1.5 fill-green-500" /> Online
                  </p>
                  {selectedConv?.detectedLanguage && LANG_LABELS[selectedConv.detectedLanguage] && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${LANG_LABELS[selectedConv.detectedLanguage].bg} ${LANG_LABELS[selectedConv.detectedLanguage].color}`}>
                      {LANG_LABELS[selectedConv.detectedLanguage].label}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {/* Tone Mode */}
                <div className="relative">
                  <button
                    onClick={() => setShowToneMenu(!showToneMenu)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs text-gray-700 font-medium"
                  >
                    <Languages className="h-3.5 w-3.5" />
                    <span className="hidden sm:block">{currentToneInfo?.label || 'Auto'}</span>
                  </button>
                  {showToneMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-200 z-50 min-w-[200px] overflow-hidden">
                      <div className="p-2 border-b border-gray-100">
                        <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider px-2">Response Tone</p>
                      </div>
                      {TONE_MODES.map(t => (
                        <button
                          key={t.value}
                          onClick={() => { setToneMode(t.value); setShowToneMenu(false); }}
                          className={`w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors ${toneMode === t.value ? 'bg-green-50' : ''}`}
                        >
                          <div className="text-sm font-medium text-gray-800">{t.label}</div>
                          <div className="text-[10px] text-gray-400">{t.desc}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setShowInfo(!showInfo)}
                  className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                >
                  <Info className="h-4 w-4" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
                  <Phone className="h-4 w-4" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Info Panel */}
            {showInfo && (
              <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-start gap-3">
                <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-xs text-blue-700">
                  <p><strong>User ID:</strong> {selectedUser}</p>
                  <p className="mt-0.5"><strong>Messages:</strong> {messages.length} total</p>
                  <p className="mt-0.5"><strong>Tone:</strong> {currentToneInfo?.label} — {currentToneInfo?.desc}</p>
                </div>
                <button onClick={() => setShowInfo(false)} className="text-blue-400 hover:text-blue-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {isRefreshing ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Bot className="h-14 w-14 mb-3 opacity-20" />
                  <p className="font-medium text-gray-500">No messages yet</p>
                  <p className="text-sm mt-1">Start the conversation</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const lang = msg.language || detectLanguage(msg.content);
                  const langInfo = LANG_LABELS[lang];
                  const isUser = msg.role === 'user';

                  return (
                    <div key={msg._id} className={`flex ${isUser ? 'justify-start' : 'justify-end'} items-end gap-2`}>
                      {isUser && (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white text-xs flex-shrink-0">
                          <User className="h-3.5 w-3.5" />
                        </div>
                      )}

                      <div className={`max-w-[70%]`}>
                        {/* Language badge */}
                        <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-1`}>
                          {langInfo && lang !== 'en' && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${langInfo.bg} ${langInfo.color}`}>
                              {langInfo.label}
                            </span>
                          )}
                          {msg.type === 'voice' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold ml-1">
                              🎤 Voice
                            </span>
                          )}
                        </div>

                        <div className={`px-4 py-2.5 rounded-2xl shadow-sm ${
                          isUser
                            ? 'bg-white text-gray-800 rounded-bl-sm'
                            : 'bg-green-600 text-white rounded-br-sm'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          <div className={`flex items-center gap-1 mt-1 ${isUser ? 'justify-start' : 'justify-end'}`}>
                            <span className={`text-[10px] ${isUser ? 'text-gray-400' : 'text-green-200'}`}>
                              {formatTime(msg.timestamp)}
                            </span>
                            {!isUser && <CheckCheck className="h-3 w-3 text-green-300" />}
                          </div>
                        </div>

                        {/* Intent badge */}
                        {msg.metadata?.intent && (
                          <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mt-1`}>
                            <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full flex items-center gap-1">
                              <Tag className="h-2 w-2" />
                              {msg.metadata.intent}
                            </span>
                          </div>
                        )}
                      </div>

                      {!isUser && (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs flex-shrink-0">
                          <Bot className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="px-4 py-3 bg-white border-t border-gray-200">
              {/* Language indicator */}
              {newMessage && (
                <div className="mb-2 flex items-center gap-2">
                  <Globe className="h-3 w-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400">
                    Detected: {typingLang === 'si' ? '🇱🇰 Sinhala' : typingLang === 'ta' ? '🇮🇳 Tamil' : '🇬🇧 English'}
                  </span>
                  <span className="text-[10px] text-gray-300">·</span>
                  <span className="text-[10px] text-gray-400">Tone: {currentToneInfo?.label}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full flex-shrink-0">
                  <Smile className="h-5 w-5" />
                </button>
                <div className="flex-1 relative">
                  <textarea
                    rows={1}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a message... (supports Sinhala, Tamil, English)"
                    className="w-full px-4 py-2.5 bg-gray-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none leading-5"
                    disabled={sending}
                    style={{ maxHeight: '120px', overflowY: 'auto' }}
                  />
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || sending}
                  className="p-2.5 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 shadow-sm"
                >
                  {sending ? (
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : newMessage.trim() ? (
                    <Send className="h-5 w-5" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-gray-50">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Bot className="h-10 w-10 text-gray-300" />
            </div>
            <h3 className="text-lg font-semibold text-gray-600 mb-2">WhatsApp Live Chat</h3>
            <p className="text-sm text-gray-400 text-center max-w-sm px-4">
              Select a conversation from the sidebar to view and send messages to users in real-time.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              {[
                { flag: '🇬🇧', lang: 'English' },
                { flag: '🇱🇰', lang: 'Sinhala' },
                { flag: '🇮🇳', lang: 'Tamil' },
              ].map(l => (
                <div key={l.lang} className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                  <div className="text-2xl mb-1">{l.flag}</div>
                  <div className="text-xs text-gray-500">{l.lang}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">Multi-language auto-detection enabled</p>
          </div>
        )}
      </div>

      {/* Click outside to close tone menu */}
      {showToneMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowToneMenu(false)} />
      )}

      {/* Export Toast Notification */}
      {exportToast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] flex items-start gap-3 px-5 py-3 rounded-xl shadow-2xl max-w-md text-sm font-medium animate-in slide-in-from-right duration-300 ${
            exportToast.type === 'success'
              ? 'bg-green-600 text-white'
              : exportToast.type === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-amber-500 text-white'
          }`}
        >
          {exportToast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : exportToast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
          )}
          <span className="flex-1 leading-relaxed">{exportToast.msg}</span>
          <button onClick={() => setExportToast(null)} className="opacity-80 hover:opacity-100 flex-shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
