import { useState, useEffect } from 'react';
import { api } from '../../config';
import { Save, RefreshCw, Bot, MessageSquare, Sparkles } from 'lucide-react';
import LanguageSwitcher, { type Language } from './LanguageSwitcher';

interface AIPersonalityConfig {
  _id: string;
  name: string;
  content: {
    en?: string;
    si?: string;
    ta?: string;
  };
  isActive: boolean;
}

interface ConversationExample {
  user: string;
  assistant: string;
}

interface AIPersonalityTabProps {
  language: Language;
  onDataChange: () => void;
}

export default function AIPersonalityTab({
  language,
  onDataChange,
}: AIPersonalityTabProps) {
  const [personality, setPersonality] = useState<AIPersonalityConfig | null>(
    null,
  );
  const [examples, setExamples] = useState<ConversationExample[]>([]);
  const [editLanguage, setEditLanguage] = useState<Language>(language);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch AI Personality
      const personalityRes = await api.get('/api/datasets?key=AI_PERSONALITY');
      const personalityData = Array.isArray(personalityRes.data)
        ? personalityRes.data
        : personalityRes.data?.datasets || personalityRes.data?.data || [];
      if (personalityData && personalityData.length > 0) {
        setPersonality(personalityData[0]);
      } else {
        // Create default personality
        setPersonality({
          _id: '',
          name: 'AI Personality',
          content: {
            en: 'You are a helpful, friendly AI assistant. Respond concisely and professionally.',
            si: '',
            ta: '',
          },
          isActive: true,
        });
      }

      // Fetch conversation examples
      const examplesRes = await api.get(
        '/api/datasets?key=CONVERSATION_EXAMPLES',
      );
      const examplesData = Array.isArray(examplesRes.data)
        ? examplesRes.data
        : examplesRes.data?.datasets || examplesRes.data?.data || [];
      if (examplesData && examplesData.length > 0) {
        setExamples(
          Array.isArray(examplesData[0].content) ? examplesData[0].content : [],
        );
      }
    } catch (error) {
      console.error('Failed to fetch AI personality:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const extractError = (error: unknown, fallback: string): string => {
    const ax = error as { response?: { data?: { error?: string } } };
    return (
      ax?.response?.data?.error ||
      (error instanceof Error ? error.message : fallback)
    );
  };

  const handleSavePersonality = async () => {
    if (!personality) return;

    setSaving(true);
    try {
      const { _id: _unused, ...rest } = personality;
      const payload = {
        ...rest,
        type: 'personality',
        key: 'AI_PERSONALITY',
      };

      // Backend handles key-based upsert, so a single POST is enough — no
      // need to branch on whether `_id` is set. This makes the flow robust
      // against stale local state (deleted doc, page reload, etc.).
      const res = await api.post('/api/datasets', payload);
      setPersonality({ ...personality, _id: res.data._id });

      onDataChange();
      alert('AI Personality saved successfully!');
    } catch (error) {
      console.error('Failed to save personality:', error);
      alert(extractError(error, 'Failed to save AI Personality'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveExamples = async () => {
    setSaving(true);
    try {
      const payload = {
        name: 'Conversation Examples',
        type: 'personality',
        key: 'CONVERSATION_EXAMPLES',
        content: examples,
        isActive: true,
      };

      await api.post('/api/datasets', payload);

      onDataChange();
      alert('Conversation examples saved successfully!');
    } catch (error) {
      console.error('Failed to save examples:', error);
      alert(extractError(error, 'Failed to save conversation examples'));
    } finally {
      setSaving(false);
    }
  };

  const handlePersonalityChange = (value: string) => {
    setPersonality((prev) =>
      prev
        ? {
            ...prev,
            content: { ...prev.content, [editLanguage]: value },
          }
        : null,
    );
  };

  const addExample = () => {
    setExamples([...examples, { user: '', assistant: '' }]);
  };

  const updateExample = (
    index: number,
    field: 'user' | 'assistant',
    value: string,
  ) => {
    const updated = [...examples];
    updated[index][field] = value;
    setExamples(updated);
  };

  const removeExample = (index: number) => {
    setExamples(examples.filter((_, i) => i !== index));
  };

  const getTranslatedLanguages = (): Language[] => {
    if (!personality?.content) return [];
    const translated: Language[] = [];
    if (personality.content.en) translated.push('en');
    if (personality.content.si) translated.push('si');
    if (personality.content.ta) translated.push('ta');
    return translated;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* AI Personality Section */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Bot className="h-5 w-5" />
              AI Personality
            </h3>
            <p className="text-sm text-gray-500">
              Define how the AI behaves and responds to users.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher
              currentLanguage={editLanguage}
              onLanguageChange={setEditLanguage}
              translatedLanguages={getTranslatedLanguages()}
              size="sm"
            />
            <button
              onClick={handleSavePersonality}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> Save
            </button>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            System Prompt ({editLanguage.toUpperCase()})
          </label>
          <textarea
            rows={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            value={personality?.content?.[editLanguage] || ''}
            onChange={(e) => handlePersonalityChange(e.target.value)}
            placeholder={`Enter the AI personality instructions in ${editLanguage.toUpperCase()}...`}
          />
          <p className="text-xs text-gray-500 mt-2">
            This prompt defines the AI's behavior, tone, and style when
            responding to users.
          </p>
        </div>
      </div>

      {/* Conversation Examples Section */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Conversation Examples
            </h3>
            <p className="text-sm text-gray-500">
              Train the AI with example conversations for better responses.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={addExample}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              <Sparkles className="h-4 w-4" /> Add Example
            </button>
            <button
              onClick={handleSaveExamples}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> Save Examples
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {examples.length === 0 ? (
            <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p>No conversation examples yet.</p>
              <p className="text-sm">
                Add examples to train the AI for better responses.
              </p>
            </div>
          ) : (
            examples.map((example, index) => (
              <div
                key={index}
                className="bg-gray-50 rounded-lg p-4 border border-gray-200"
              >
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium text-gray-600">
                    Example {index + 1}
                  </span>
                  <button
                    onClick={() => removeExample(index)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-blue-600 mb-1">
                      User Message
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                      value={example.user}
                      onChange={(e) =>
                        updateExample(index, 'user', e.target.value)
                      }
                      placeholder="What the user might say..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-green-600 mb-1">
                      AI Response
                    </label>
                    <textarea
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                      value={example.assistant}
                      onChange={(e) =>
                        updateExample(index, 'assistant', e.target.value)
                      }
                      placeholder="How the AI should respond..."
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tips Section */}
      <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">
          Tips for AI Personality
        </h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Be specific about the AI's role and capabilities</li>
          <li>• Include guidelines for handling unknown questions</li>
          <li>• Specify the tone (professional, friendly, casual)</li>
          <li>• Add language-specific instructions for Sinhala and Tamil</li>
          <li>
            • Conversation examples help the AI learn preferred response
            patterns
          </li>
        </ul>
      </div>
    </div>
  );
}
