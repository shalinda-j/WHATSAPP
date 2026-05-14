import { useState, useEffect } from 'react';
import { api } from '../config';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  User,
  Phone,
  Plus,
  X,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  MapPin,
  Video,
} from 'lucide-react';

interface Booking {
  _id: string;
  clientName: string;
  clientPhone: string;
  date: string;
  time?: string;
  duration?: number;
  type?: string;
  notes?: string;
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed';
  sessionId?: string;
  createdAt: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
  completed: 'bg-blue-100 text-blue-800 border-blue-200',
};

const STATUS_DOT: Record<string, string> = {
  confirmed: 'bg-green-500',
  pending: 'bg-yellow-500',
  cancelled: 'bg-red-500',
  completed: 'bg-blue-500',
};

export default function Calendar() {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(
    today.getDate(),
  );
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [_view, _setView] = useState<'month' | 'week' | 'day'>('month');
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [newBooking, setNewBooking] = useState({
    clientName: '',
    clientPhone: '',
    date: today.toISOString().split('T')[0],
    time: '10:00',
    duration: 30,
    type: 'Consultation',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const res = await api
        .get(`/api/analytics/bookings?year=${year}&month=${month}`)
        .catch(() => ({ data: { bookings: [] } }));
      const data = res.data?.bookings || res.data || [];
      setBookings(Array.isArray(data) ? data : []);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [currentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [message]);

  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];

    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    while (days.length % 7 !== 0) days.push(null);

    return days;
  };

  const getBookingsForDay = (day: number | null): Booking[] => {
    if (!day) return [];
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    return bookings.filter((b) => {
      const d = new Date(b.date);
      return (
        d.getFullYear() === year &&
        d.getMonth() === month &&
        d.getDate() === day
      );
    });
  };

  const isToday = (day: number | null) => {
    if (!day) return false;
    const t = new Date();
    return (
      t.getDate() === day &&
      t.getMonth() === currentDate.getMonth() &&
      t.getFullYear() === currentDate.getFullYear()
    );
  };

  const navigateMonth = (dir: 1 | -1) => {
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() + dir, 1),
    );
    setSelectedDay(null);
  };

  const selectedDayBookings = selectedDay ? getBookingsForDay(selectedDay) : [];

  const handleCreateBooking = async () => {
    if (!newBooking.clientName || !newBooking.clientPhone || !newBooking.date) {
      setMessage({ type: 'error', text: 'Please fill in all required fields' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/analytics/bookings', newBooking);
      setMessage({ type: 'success', text: 'Booking created successfully!' });
      setShowNewBooking(false);
      setNewBooking({
        clientName: '',
        clientPhone: '',
        date: today.toISOString().split('T')[0],
        time: '10:00',
        duration: 30,
        type: 'Consultation',
        notes: '',
      });
      fetchBookings();
    } catch {
      setMessage({ type: 'error', text: 'Failed to create booking' });
    } finally {
      setSaving(false);
    }
  };

  const updateBookingStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/api/analytics/bookings/${id}`, { status });
      setBookings((prev) =>
        prev.map((b) =>
          b._id === id ? { ...b, status: status as Booking['status'] } : b,
        ),
      );
      if (selectedBooking?._id === id)
        setSelectedBooking((prev) =>
          prev ? { ...prev, status: status as Booking['status'] } : null,
        );
      setMessage({ type: 'success', text: 'Status updated' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to update status' });
    }
  };

  const days = getDaysInMonth();
  const upcomingBookings = bookings
    .filter((b) => new Date(b.date) >= today && b.status !== 'cancelled')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5);

  return (
    <div className="max-w-7xl mx-auto pb-8">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl">
              <CalendarIcon className="h-6 w-6 text-white" />
            </div>
            Appointment Calendar
          </h1>
          <p className="text-gray-500 mt-1 ml-1">
            Manage bookings and scheduled appointments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchBookings}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNewBooking(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm shadow-sm"
          >
            <Plus className="h-4 w-4" />
            New Booking
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

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Calendar */}
        <div className="xl:col-span-3">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Calendar Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
              <button
                onClick={() => navigateMonth(-1)}
                className="p-1.5 rounded-lg hover:bg-white/20"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="text-center">
                <h2 className="text-xl font-bold">
                  {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                </h2>
                <p className="text-blue-200 text-sm">
                  {bookings.length} bookings this month
                </p>
              </div>
              <button
                onClick={() => navigateMonth(1)}
                className="p-1.5 rounded-lg hover:bg-white/20"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 border-b border-gray-100">
              {DAYS.map((d) => (
                <div
                  key={d}
                  className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7">
              {days.map((day, idx) => {
                const dayBookings = getBookingsForDay(day);
                const isSel = selectedDay === day && day !== null;
                const isT = isToday(day);

                return (
                  <div
                    key={idx}
                    onClick={() => day && setSelectedDay(day)}
                    className={`min-h-[80px] p-1.5 border-b border-r border-gray-100 cursor-pointer transition-colors ${
                      !day
                        ? 'bg-gray-50/50'
                        : isSel
                        ? 'bg-blue-50'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    {day && (
                      <>
                        <div
                          className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium mb-1 ${
                            isT
                              ? 'bg-blue-600 text-white'
                              : isSel
                              ? 'bg-blue-100 text-blue-700'
                              : 'text-gray-700'
                          }`}
                        >
                          {day}
                        </div>
                        <div className="space-y-0.5">
                          {dayBookings.slice(0, 2).map((b) => (
                            <div
                              key={b._id}
                              className={`text-[10px] px-1.5 py-0.5 rounded truncate ${
                                STATUS_COLORS[b.status] ||
                                'bg-gray-100 text-gray-700'
                              }`}
                              title={b.clientName}
                            >
                              {b.clientName}
                            </div>
                          ))}
                          {dayBookings.length > 2 && (
                            <div className="text-[10px] text-gray-500 px-1">
                              +{dayBookings.length - 2} more
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Day Bookings */}
          {selectedDay && (
            <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-blue-600" />
                {MONTHS[currentDate.getMonth()]} {selectedDay},{' '}
                {currentDate.getFullYear()}
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-1">
                  {selectedDayBookings.length} booking
                  {selectedDayBookings.length !== 1 ? 's' : ''}
                </span>
              </h3>
              {selectedDayBookings.length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <CalendarIcon className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No bookings for this day</p>
                  <button
                    onClick={() => {
                      setNewBooking((p) => ({
                        ...p,
                        date: `${currentDate.getFullYear()}-${String(
                          currentDate.getMonth() + 1,
                        ).padStart(2, '0')}-${String(selectedDay).padStart(
                          2,
                          '0',
                        )}`,
                      }));
                      setShowNewBooking(true);
                    }}
                    className="mt-2 text-xs text-blue-600 hover:underline"
                  >
                    + Add booking for this day
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedDayBookings.map((b) => (
                    <div
                      key={b._id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-blue-200 cursor-pointer hover:bg-blue-50/50 transition-colors"
                      onClick={() => setSelectedBooking(b)}
                    >
                      <div
                        className={`w-2 h-10 rounded-full ${
                          STATUS_DOT[b.status] || 'bg-gray-400'
                        }`}
                      ></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm">
                          {b.clientName}
                        </p>
                        <p className="text-xs text-gray-500 flex items-center gap-2">
                          <Phone className="h-3 w-3" />
                          {b.clientPhone}
                          {b.time && (
                            <>
                              <Clock className="h-3 w-3 ml-1" />
                              {b.time}
                            </>
                          )}
                          {b.type && (
                            <>
                              <MapPin className="h-3 w-3 ml-1" />
                              {b.type}
                            </>
                          )}
                        </p>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full border font-medium ${
                          STATUS_COLORS[b.status]
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          {/* Stats */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800 mb-3 text-sm">
              This Month
            </h3>
            <div className="space-y-2">
              {[
                {
                  label: 'Total Bookings',
                  count: bookings.length,
                  color: 'text-blue-600',
                },
                {
                  label: 'Confirmed',
                  count: bookings.filter((b) => b.status === 'confirmed')
                    .length,
                  color: 'text-green-600',
                },
                {
                  label: 'Pending',
                  count: bookings.filter((b) => b.status === 'pending').length,
                  color: 'text-yellow-600',
                },
                {
                  label: 'Cancelled',
                  count: bookings.filter((b) => b.status === 'cancelled')
                    .length,
                  color: 'text-red-600',
                },
                {
                  label: 'Completed',
                  count: bookings.filter((b) => b.status === 'completed')
                    .length,
                  color: 'text-blue-400',
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-xs text-gray-500">{s.label}</span>
                  <span className={`text-sm font-bold ${s.color}`}>
                    {s.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800 mb-3 text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600" />
              Upcoming
            </h3>
            {upcomingBookings.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">
                No upcoming bookings
              </p>
            ) : (
              <div className="space-y-2">
                {upcomingBookings.map((b) => (
                  <div
                    key={b._id}
                    className="p-2.5 rounded-lg bg-gray-50 hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedBooking(b)}
                  >
                    <p className="text-xs font-semibold text-gray-800 truncate">
                      {b.clientName}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {new Date(b.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                      {b.time && ` · ${b.time}`}
                    </p>
                    <div
                      className={`inline-flex items-center gap-1 mt-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                        STATUS_COLORS[b.status]
                      }`}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          STATUS_DOT[b.status]
                        }`}
                      ></div>
                      {b.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Booking Detail Modal */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">
                Booking Details
              </h3>
              <button
                onClick={() => setSelectedBooking(null)}
                className="p-1.5 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <User className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-xs text-gray-500">Client</p>
                  <p className="font-semibold text-gray-900">
                    {selectedBooking.clientName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Phone className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-xs text-gray-500">Phone</p>
                  <p className="font-semibold text-gray-900">
                    {selectedBooking.clientPhone}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <CalendarIcon className="h-5 w-5 text-purple-600" />
                <div>
                  <p className="text-xs text-gray-500">Date & Time</p>
                  <p className="font-semibold text-gray-900">
                    {new Date(selectedBooking.date).toLocaleDateString(
                      'en-US',
                      {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      },
                    )}
                    {selectedBooking.time && ` · ${selectedBooking.time}`}
                  </p>
                </div>
              </div>
              {selectedBooking.type && (
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <Video className="h-5 w-5 text-orange-600" />
                  <div>
                    <p className="text-xs text-gray-500">Type</p>
                    <p className="font-semibold text-gray-900">
                      {selectedBooking.type}
                    </p>
                  </div>
                </div>
              )}
              {selectedBooking.notes && (
                <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                  <p className="text-xs text-yellow-700 font-medium mb-1">
                    Notes
                  </p>
                  <p className="text-sm text-gray-700">
                    {selectedBooking.notes}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 mb-2">Update Status</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    ['confirmed', 'pending', 'completed', 'cancelled'] as const
                  ).map((s) => (
                    <button
                      key={s}
                      onClick={() =>
                        updateBookingStatus(selectedBooking._id, s)
                      }
                      className={`py-2 px-3 rounded-lg text-xs font-medium border capitalize transition-colors ${
                        selectedBooking.status === s
                          ? STATUS_COLORS[s] + ' font-bold'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Booking Modal */}
      {showNewBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">New Booking</h3>
              <button
                onClick={() => setShowNewBooking(false)}
                className="p-1.5 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {[
                {
                  label: 'Client Name *',
                  field: 'clientName',
                  type: 'text',
                  placeholder: 'Enter client name',
                },
                {
                  label: 'Phone *',
                  field: 'clientPhone',
                  type: 'tel',
                  placeholder: '+94771234567',
                },
                {
                  label: 'Date *',
                  field: 'date',
                  type: 'date',
                  placeholder: '',
                },
                { label: 'Time', field: 'time', type: 'time', placeholder: '' },
                {
                  label: 'Duration (min)',
                  field: 'duration',
                  type: 'number',
                  placeholder: '30',
                },
              ].map(({ label, field, type, placeholder }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {label}
                  </label>
                  <input
                    type={type}
                    value={
                      (newBooking as Record<string, string | number>)[field]
                    }
                    onChange={(e) =>
                      setNewBooking((p) => ({ ...p, [field]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={newBooking.type}
                  onChange={(e) =>
                    setNewBooking((p) => ({ ...p, type: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {[
                    'Consultation',
                    'Follow-up',
                    'Demo',
                    'Interview',
                    'Meeting',
                    'Other',
                  ].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={newBooking.notes}
                  onChange={(e) =>
                    setNewBooking((p) => ({ ...p, notes: e.target.value }))
                  }
                  placeholder="Optional notes..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowNewBooking(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBooking}
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
