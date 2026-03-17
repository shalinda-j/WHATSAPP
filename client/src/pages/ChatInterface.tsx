import { useState, useEffect, useRef } from 'react';
import { api } from '../config';
import { io, Socket } from 'socket.io-client';
import {
  Search, Send, Paperclip, MoreVertical,
  Phone, Video, ChevronLeft, CheckCheck,
  Circle, Bot, User, Mic, Smile
} from 'lucide-react';

interface Message {
  _id: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'voice' | 'image' | 'document';
  content: string;
  timestamp: Date;
  metadata?: {
    intent?: string;
    buyingSignal?: string;
    isBooking?: boolean;
  };
}

interface Conversation {
  userId: string;
  lastMessage?: Message;
  unreadCount: number;
  userInfo?: {
    name?: string;
    phone?: string;
  };
}

export default function ChatInterface() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [, setSocket] = useState<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showMobileChat, setShowMobileChat] = useState(false);

  // Initialize WebSocket connection
  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || window.location.origin;
    const newSocket = io(API_URL);

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket');
    });

    newSocket.on('new-message', (data: Message) => {
      // Add message to the appropriate conversation
      if (selectedUser === data.userId) {
        setMessages(prev => [...prev, data]);
      }
      // Update conversation list
      setConversations(prev => {
        const existing = prev.find(c => c.userId === data.userId);
        if (existing) {
          return prev.map(c => c.userId === data.userId
            ? { ...c, lastMessage: data, unreadCount: c.userId !== selectedUser ? c.unreadCount + 1 : 0 }
            : c
          ).sort((a, b) => new Date(b.lastMessage?.timestamp || 0).getTime() - new Date(a.lastMessage?.timestamp || 0).getTime());
        } else {
          return [{ userId: data.userId, lastMessage: data, unreadCount: 1 }, ...prev];
        }
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [selectedUser]);

  // Fetch conversations
  useEffect(() => {
    fetchConversations();
  }, []);

  // Fetch messages when user selected
  useEffect(() => {
    if (selectedUser) {
      fetchMessages(selectedUser);
    }
  }, [selectedUser]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/chat/conversations');
      setConversations(res.data.conversations || []);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (userId: string) => {
    try {
      const res = await api.get(`/api/chat/messages/${encodeURIComponent(userId)}`);
      setMessages(res.data.messages || []);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedUser || sending) return;

    setSending(true);
    try {
      await api.post('/api/chat/send', {
        userId: selectedUser,
        message: newMessage.trim()
      });
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date | string) => {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) {
      return formatTime(d);
    } else if (d.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const getUserDisplayName = (userId: string) => {
    const phone = userId.split('@')[0];
    const conv = conversations.find(c => c.userId === userId);
    return conv?.userInfo?.name || conv?.userInfo?.phone || phone;
  };

  const filteredConversations = conversations.filter(c =>
    c.userId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-120px)] bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">
      {/* Left Sidebar - Conversation List */}
      <div className={`${showMobileChat ? 'hidden md:flex' : 'flex'} w-full md:w-96 flex-col border-r border-gray-200 bg-gray-50`}>

        {/* Header */}
        <div className="px-4 py-3 bg-white border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold text-gray-800">💬 Chats</h1>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                {conversations.length} Users
              </span>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs text-gray-400 mt-1">Messages will appear here</p>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <div
                key={conv.userId}
                onClick={() => {
                  setSelectedUser(conv.userId);
                  setShowMobileChat(true);
                  // Mark as read
                  setConversations(prev => prev.map(c =>
                    c.userId === conv.userId ? { ...c, unreadCount: 0 } : c
                  ));
                }}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                  selectedUser === conv.userId
                    ? 'bg-green-50 border-l-4 border-green-500'
                    : 'hover:bg-gray-100 border-l-4 border-transparent'
                }`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-bold text-lg">
                    {getUserDisplayName(conv.userId).charAt(0).toUpperCase()}
                  </div>
                  {conv.unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 truncate text-sm">
                      {getUserDisplayName(conv.userId)}
                    </h3>
                    {conv.lastMessage && (
                      <span className="text-xs text-gray-400">
                        {formatDate(conv.lastMessage.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {conv.lastMessage?.role === 'assistant' && (
                      <CheckCheck className="h-3 w-3 text-blue-500 flex-shrink-0" />
                    )}
                    <p className="text-xs text-gray-500 truncate">
                      {conv.lastMessage?.role === 'user' ? '👤 ' : '🤖 '}
                      {conv.lastMessage?.content || 'No messages'}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel - Chat Area */}
      <div className={`${showMobileChat ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-gray-50`}>

        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center gap-3">
              <button
                onClick={() => setShowMobileChat(false)}
                className="md:hidden p-1 hover:bg-gray-100 rounded"
              >
                <ChevronLeft className="h-6 w-6 text-gray-600" />
              </button>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-bold">
                {getUserDisplayName(selectedUser).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-gray-900">{getUserDisplayName(selectedUser)}</h2>
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <Circle className="h-2 w-2 fill-green-500" /> Online
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <Video className="h-5 w-5 text-gray-600" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <Phone className="h-5 w-5 text-gray-600" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <MoreVertical className="h-5 w-5 text-gray-600" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%www.w3.org/2000/svg%22%20viewBox%3D%220%200%2080%2080%22%20width%3D%2280%22%20height%3D%2280%22%3E%3Ccircle%20fill%3D%22%23e5e7eb%22%20cx%3D%2240%22%20cy%3D%2240%22%20r%3D%222%22%2F%3E%3C%2Fsvg%3E')]">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <Bot className="h-16 w-16 text-gray-300 mb-4" />
                  <p className="text-lg font-medium">No messages yet</p>
                  <p className="text-sm text-gray-400">Start a conversation</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg._id}
                    className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div className={`flex items-end gap-2 max-w-[75%] ${msg.role === 'user' ? 'flex-row' : 'flex-row-reverse'}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-br from-gray-400 to-gray-600'
                          : 'bg-gradient-to-br from-green-400 to-green-600'
                      }`}>
                        {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </div>
                      <div className={`px-4 py-2 rounded-2xl ${
                        msg.role === 'user'
                          ? 'bg-white text-gray-800 rounded-bl-sm shadow-sm'
                          : 'bg-green-100 text-gray-800 rounded-br-sm'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <div className="flex items-center gap-1 mt-1 justify-end">
                          <span className="text-[10px] text-gray-400">{formatTime(msg.timestamp)}</span>
                          {msg.role === 'assistant' && (
                            <CheckCheck className="h-3 w-3 text-blue-500" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="px-4 py-3 bg-white border-t border-gray-200">
              <div className="flex items-center gap-2">
                <button className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full">
                  <Smile className="h-5 w-5" />
                </button>
                <button className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full">
                  <Paperclip className="h-5 w-5" />
                </button>
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type a message..."
                    className="w-full px-4 py-2 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    disabled={sending}
                  />
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || sending}
                  className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Bot className="h-12 w-12 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">WhatsApp Chat Interface</h3>
            <p className="text-sm text-gray-500 text-center max-w-sm">
              Select a conversation from the sidebar to view and send messages to users in real-time.
            </p>
            <p className="text-xs text-gray-400 mt-4">
              💡 Messages sent here go directly to users via WhatsApp
            </p>
          </div>
        )}
      </div>
    </div>
  );
}