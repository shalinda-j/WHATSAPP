import { useState, useEffect, useRef } from 'react';
import { api } from '../config';
import { io, Socket } from 'socket.io-client';
import {
  Smartphone,
  Plus,
  Trash,
  Wifi,
  WifiOff,
  Loader,
  Edit,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface Session {
  sessionId: string;
  sessionName: string;
  status:
    'connecting' | 'connected' | 'disconnected' | 'scan_qr' | 'reconnecting';
  qr?: string;
  phoneNumber?: string;
  updatedAt: string;
}

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const fetchSessions = async () => {
    try {
      const res = await api.get('/api/sessions');
      // Support both old and new API response formats safely
      const sessionList = Array.isArray(res.data)
        ? res.data
        : res.data.sessions;
      setSessions(sessionList || []);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch sessions', error);
    }
  };

  useEffect(() => {
    fetchSessions();

    // FIX M10: Replace aggressive 3-second polling with Socket.io-driven
    // updates. The server emits 'session-status-update' whenever a session
    // changes state (QR ready, connected, disconnected). We still keep a
    // 10-second fallback poll for cases where the socket is unavailable
    // (e.g. the server is behind a proxy that doesn't support WebSocket).
    const token = localStorage.getItem('token') || '';
    const socket = io('/', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('session-status-update', () => {
      // Any session state change → re-fetch the full list
      fetchSessions();
    });
    socket.on('qr-update', () => {
      // QR code changed → re-fetch so the new QR renders immediately
      fetchSessions();
    });

    // Fallback poll — 10 s is acceptable; real-time updates come via socket
    const interval = setInterval(fetchSessions, 10000);

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, []);

  const handleCreateSession = async () => {
    const name = prompt("Enter a name for this device (e.g. 'Support 1'):");
    if (!name) return;

    setCreating(true);
    try {
      await api.post('/api/sessions', { sessionName: name });
      await fetchSessions();
    } catch {
      alert('Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const handleRenameSession = async (id: string, currentName: string) => {
    const newName = prompt('Enter new name for this device:', currentName);
    if (!newName || newName === currentName) return;

    try {
      await api.put(`/api/sessions/${id}/name`, { sessionName: newName });
      fetchSessions();
    } catch {
      alert('Failed to rename session');
    }
  };

  const handleDeleteSession = async (id: string, name: string) => {
    if (
      !confirm(
        `Are you sure you want to remove '${name}'? This will disconnect the device.`,
      )
    )
      return;
    try {
      await api.delete(`/api/sessions/${id}`);
      fetchSessions();
    } catch {
      alert('Failed to delete session');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'scan_qr':
        return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'disconnected':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-blue-600 bg-blue-50 border-blue-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <Wifi className="w-5 h-5" />;
      case 'disconnected':
        return <WifiOff className="w-5 h-5" />;
      case 'scan_qr':
        return <Smartphone className="w-5 h-5" />;
      default:
        return <Loader className="w-5 h-5 animate-spin" />;
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Linked Devices</h1>
          <p className="text-gray-500 mt-1">
            Manage multiple WhatsApp accounts connected to this bot.
          </p>
        </div>
        <button
          onClick={handleCreateSession}
          disabled={creating}
          className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
        >
          {creating ? (
            <Loader className="animate-spin w-5 h-5 mr-2" />
          ) : (
            <Plus className="w-5 h-5 mr-2" />
          )}
          Add New Device
        </button>
      </div>

      {loading && sessions.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          Loading devices...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden ${
                session.status === 'connected'
                  ? 'border-green-100'
                  : 'border-gray-100'
              }`}
            >
              {/* Header */}
              <div className="p-4 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
                <div>
                  <h3 className="font-bold text-lg text-gray-800">
                    {session.sessionName || session.sessionId}
                  </h3>
                  <p className="text-xs text-gray-400 font-mono mt-1">
                    {session.sessionId}
                  </p>
                </div>
                <button
                  onClick={() =>
                    handleRenameSession(session.sessionId, session.sessionName)
                  }
                  className="p-2 text-gray-400 hover:text-blue-500 transition rounded-full hover:bg-blue-50 mr-1"
                  title="Rename Device"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() =>
                    handleDeleteSession(session.sessionId, session.sessionName)
                  }
                  className="p-2 text-gray-400 hover:text-red-500 transition rounded-full hover:bg-red-50"
                  title="Disconnect & Remove"
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 flex flex-col items-center justify-center min-h-[200px]">
                <div
                  className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium mb-4 ${getStatusColor(
                    session.status,
                  )}`}
                >
                  {getStatusIcon(session.status)}
                  <span className="capitalize">
                    {(session.status || '').replace('_', ' ')}
                  </span>
                </div>

                {session.status === 'scan_qr' && session.qr ? (
                  <div className="flex flex-col items-center animate-in fade-in duration-500">
                    <div className="bg-white p-2 rounded-lg border shadow-sm">
                      <QRCodeSVG
                        value={session.qr}
                        size={264}
                        level="M"
                        includeMargin={true}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-3 text-center">
                      Open WhatsApp → Settings → Linked Devices → Link a Device
                    </p>
                  </div>
                ) : session.status === 'connected' ? (
                  <div className="text-center">
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Wifi className="w-8 h-8" />
                    </div>
                    <p className="text-gray-600 font-medium">
                      Device is Online
                    </p>
                    {session.phoneNumber && (
                      <p className="text-sm text-gray-500 mt-1">
                        {session.phoneNumber}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-gray-400">
                    {session.status === 'connecting'
                      ? 'Initializing...'
                      : 'Waiting for status...'}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-gray-50 px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-100">
                Last updated: {new Date(session.updatedAt).toLocaleTimeString()}
              </div>
            </div>
          ))}

          {/* Empty State Card */}
          {sessions.length === 0 && (
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center text-gray-400 min-h-[300px]">
              <Smartphone className="w-12 h-12 mb-3 opacity-20" />
              <p>No devices connected.</p>
              <button
                onClick={handleCreateSession}
                className="mt-4 text-blue-600 font-medium hover:underline"
              >
                Link your first device
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
