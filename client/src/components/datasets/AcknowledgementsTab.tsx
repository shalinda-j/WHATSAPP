import { useState, useEffect } from 'react';
import { api } from '../../config';
import {
  Plus,
  Trash,
  Save,
  RefreshCw,
  MessageSquare,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import LanguageSwitcher, { type Language } from './LanguageSwitcher';

interface Acknowledgement {
  trigger: string;
  reply: string;
}

interface AcknowledgementsDoc {
  _id: string;
  name: string;
  content: {
    en?: Acknowledgement[];
    si?: Acknowledgement[];
    ta?: Acknowledgement[];
  };
  isActive: boolean;
}

interface AcknowledgementsTabProps {
  language: Language;
  onDataChange: () => void;
}

const KEY = 'ACKNOWLEDGEMENTS';

const SUGGESTED: Record<Language, Acknowledgement[]> = {
  en: [
    {
      trigger: 'thanks|thank you|thx|ty',
      reply: "You're welcome! Let me know if you need anything else.",
    },
    {
      trigger: 'ok|okay|got it|noted',
      reply: 'Got it. I’ll keep that in mind.',
    },
    { trigger: 'hi|hello|hey', reply: 'Hi there! How can I help today?' },
  ],
  si: [
    {
      trigger: 'thanks|ස්තූතියි|stuthi',
      reply: 'ඔබට ස්තූතියි! වැඩිදුර උදව්වක් ඕනෙ නම් කියන්න.',
    },
    { trigger: 'හරි|ok|hari', reply: 'හරි, මේක මතක තියාගන්නම්.' },
    { trigger: 'හෙලෝ|hi|ආයුබෝවන්', reply: 'ආයුබෝවන්! කොහොමද උදව් කරන්නේ?' },
  ],
  ta: [
    {
      trigger: 'நன்றி|thanks|nandri',
      reply: 'வரவேற்கிறேன்! வேறு உதவி வேண்டுமா என்று சொல்லுங்கள்.',
    },
    { trigger: 'சரி|ok|sari', reply: 'சரி, அதை மனதில் வைத்திருக்கிறேன்.' },
    { trigger: 'வணக்கம்|hi|hello', reply: 'வணக்கம்! எப்படி உதவ முடியும்?' },
  ],
};

export default function AcknowledgementsTab({
  language,
  onDataChange,
}: AcknowledgementsTabProps) {
  const [doc, setDoc] = useState<AcknowledgementsDoc | null>(null);
  const [editLanguage, setEditLanguage] = useState<Language>(language);
  const [rows, setRows] = useState<Acknowledgement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const extractError = (error: unknown, fallback: string): string => {
    const ax = error as { response?: { data?: { error?: string } } };
    return (
      ax?.response?.data?.error ||
      (error instanceof Error ? error.message : fallback)
    );
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/datasets?key=${KEY}`);
      const list = Array.isArray(res.data)
        ? res.data
        : res.data?.datasets || res.data?.data || [];
      if (list && list.length > 0) {
        const d = list[0] as AcknowledgementsDoc;
        setDoc(d);
        setRows((d.content?.[editLanguage] as Acknowledgement[]) ?? []);
      } else {
        setDoc({
          _id: '',
          name: 'Acknowledgements',
          content: {},
          isActive: true,
        });
        setRows([]);
      }
    } catch (err) {
      console.error('Failed to load acknowledgements:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!doc) return;
    setRows((doc.content?.[editLanguage] as Acknowledgement[]) ?? []);
  }, [editLanguage, doc]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: 'Acknowledgements',
        type: 'personality',
        key: KEY,
        content: {
          ...(doc?.content ?? {}),
          [editLanguage]: rows,
        },
        isActive: true,
      };
      const res = await api.post('/api/datasets', payload);
      setDoc(res.data);
      onDataChange();
      alert('Acknowledgements saved.');
    } catch (error) {
      alert(extractError(error, 'Failed to save acknowledgements'));
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => setRows([...rows, { trigger: '', reply: '' }]);
  const updateRow = (i: number, field: keyof Acknowledgement, value: string) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const loadSuggested = () => setRows([...rows, ...SUGGESTED[editLanguage]]);

  const translatedLanguages: Language[] = (() => {
    if (!doc?.content) return [];
    const out: Language[] = [];
    if (doc.content.en?.length) out.push('en');
    if (doc.content.si?.length) out.push('si');
    if (doc.content.ta?.length) out.push('ta');
    return out;
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-start gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Acknowledgements
          </h3>
          <p className="text-sm text-gray-500">
            Short canned replies for thanks, hellos, and confirmations.
            Triggered before the full AI chain so easy messages stay cheap and
            instant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher
            currentLanguage={editLanguage}
            onLanguageChange={setEditLanguage}
            translatedLanguages={translatedLanguages}
            size="sm"
          />
          <button
            onClick={loadSuggested}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
          >
            <Sparkles className="h-4 w-4" /> Load suggested
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            <Save className="h-4 w-4" /> Save
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-10 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="font-medium text-gray-700">No acknowledgements yet</p>
          <p className="text-sm">
            Click <em>Load suggested</em> for a starting set, or add your own.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div
              key={i}
              className="bg-gray-50 rounded-lg p-3 border border-gray-200"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-medium text-gray-600">
                  #{i + 1}
                </span>
                <button
                  onClick={() => removeRow(i)}
                  className="text-red-500 hover:text-red-700 text-sm inline-flex items-center gap-1"
                >
                  <Trash className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-blue-600 mb-1">
                    Trigger (pipe-separated alternatives)
                  </label>
                  <input
                    type="text"
                    value={row.trigger}
                    onChange={(e) => updateRow(i, 'trigger', e.target.value)}
                    placeholder="thanks|thank you|thx"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-green-600 mb-1">
                    Reply
                  </label>
                  <input
                    type="text"
                    value={row.reply}
                    onChange={(e) => updateRow(i, 'reply', e.target.value)}
                    placeholder="You're welcome!"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={addRow}
            className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" /> Add row
          </button>
        </div>
      )}

      <div className="mt-6 bg-blue-50 rounded-lg p-4 border border-blue-100">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">
          How acknowledgements work
        </h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>
            • Triggers are case-insensitive and treat <code>|</code> as
            alternation (regex-style).
          </li>
          <li>
            • Matched messages get the canned reply directly — no AI provider
            call, no token usage.
          </li>
          <li>
            • Language is auto-detected from the message — store the same
            trigger under each language tab.
          </li>
        </ul>
      </div>
    </div>
  );
}
