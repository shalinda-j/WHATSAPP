import { useEffect, useState, FormEvent } from 'react';
import { api } from '../config';
import {
  TrendingUp,
  UserCheck,
  CalendarCheck,
  Wallet,
  RefreshCw,
} from 'lucide-react';

interface ConversionStats {
  total: number;
  byKind: Record<string, number>;
  recent: Array<{
    _id?: string;
    phoneNumber?: string;
    kind?: string;
    createdAt?: string;
  }>;
}

const KIND_LABELS: Record<string, string> = {
  lead_registered: 'Registrations',
  booking_created: 'Visits booked',
  fee_paid: 'Fees paid',
};

export default function ConversionsCard() {
  const [stats, setStats] = useState<ConversionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/conversions/stats');
      setStats(res.data as ConversionStats);
    } catch {
      setStats({ total: 0, byKind: {}, recent: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const markFeePaid = async (e: FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      await api.post('/api/conversions/fee-paid', {
        phoneNumber: phone.trim(),
        valueLkr: amount ? Number(amount) : undefined,
      });
      setMsg('✅ Recorded');
      setPhone('');
      setAmount('');
      await load();
    } catch {
      setMsg('❌ Failed — check the number and try again');
    } finally {
      setSaving(false);
    }
  };

  const k = stats?.byKind || {};

  return (
    <div className="bg-white p-6 rounded-xl shadow-md mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-indigo-600" /> Conversions
        </h2>
        <button
          onClick={load}
          className="text-gray-400 hover:text-indigo-600"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-indigo-50 p-3 rounded-lg">
          <p className="text-2xl font-bold text-indigo-700">
            {stats?.total ?? 0}
          </p>
          <p className="text-xs text-gray-500">Total</p>
        </div>
        <div className="bg-green-50 p-3 rounded-lg">
          <p className="text-2xl font-bold text-green-700 flex items-center gap-1">
            <UserCheck className="h-4 w-4" />
            {k.lead_registered ?? 0}
          </p>
          <p className="text-xs text-gray-500">{KIND_LABELS.lead_registered}</p>
        </div>
        <div className="bg-blue-50 p-3 rounded-lg">
          <p className="text-2xl font-bold text-blue-700 flex items-center gap-1">
            <CalendarCheck className="h-4 w-4" />
            {k.booking_created ?? 0}
          </p>
          <p className="text-xs text-gray-500">{KIND_LABELS.booking_created}</p>
        </div>
        <div className="bg-amber-50 p-3 rounded-lg">
          <p className="text-2xl font-bold text-amber-700 flex items-center gap-1">
            <Wallet className="h-4 w-4" />
            {k.fee_paid ?? 0}
          </p>
          <p className="text-xs text-gray-500">{KIND_LABELS.fee_paid}</p>
        </div>
      </div>

      <form
        onSubmit={markFeePaid}
        className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4"
      >
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-gray-500 mb-1">
            Mark a fee as paid — phone number
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9477xxxxxxx"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="w-32">
          <label className="block text-xs text-gray-500 mb-1">
            Amount (LKR)
          </label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="optional"
            inputMode="numeric"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving || !phone.trim()}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Mark paid'}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </form>
    </div>
  );
}
