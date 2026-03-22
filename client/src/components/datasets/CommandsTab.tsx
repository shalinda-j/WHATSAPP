import { useState, useEffect } from 'react';
import { api } from '../../config';
import { ToggleLeft, ToggleRight, Edit, Save, X, RefreshCw } from 'lucide-react';
import LanguageSwitcher, { Language } from './LanguageSwitcher';

interface CommandConfig {
  _id: string;
  name: string;
  description?: string;
  content: {
    en?: { message: string; description?: string };
    si?: { message: string; description?: string };
    ta?: { message: string; description?: string };
  };
  isActive: boolean;
  metadata?: {
    triggerKeywords?: string[];
    aliases?: string[];
  };
}

interface CommandsTabProps {
  language: Language;
  onDataChange: () => void;
}

// Default commands that exist in the system
const defaultCommands = [
  { name: 'help', description: 'Show available commands' },
  { name: 'register', description: 'Start registration process' },
  { name: 'jobs', description: 'List available jobs' },
  { name: 'ping', description: 'Check bot status' },
  { name: 'clear', description: 'Clear conversation' },
  { name: 'ai', description: 'Chat with AI' },
  { name: 'si', description: 'Chat in Sinhala' },
  { name: 'profile', description: 'View user profile' },
];

export default function CommandsTab({ language, onDataChange }: CommandsTabProps) {
  const [commands, setCommands] = useState<CommandConfig[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCommand, setEditingCommand] = useState<CommandConfig | null>(null);
  const [editLanguage, setEditLanguage] = useState<Language>(language);
  const [loading, setLoading] = useState(true);

  const fetchCommands = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/datasets?type=command');
      setCommands(res.data);
    } catch (error) {
      console.error('Failed to fetch commands:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCommands();
  }, []);

  const handleToggle = async (command: CommandConfig) => {
    try {
      if (command._id) {
        await api.put(`/api/datasets/${command._id}`, {
          ...command,
          isActive: !command.isActive,
        });
      } else {
        // Create new command config
        await api.post('/api/datasets', {
          ...command,
          type: 'command',
          isActive: !command.isActive,
        });
      }
      fetchCommands();
      onDataChange();
    } catch (error) {
      console.error('Failed to toggle command:', error);
      alert('Failed to update command status');
    }
  };

  const handleEdit = (command: CommandConfig) => {
    setEditingCommand(command);
    setEditLanguage(language);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editingCommand) return;

    try {
      const payload = {
        ...editingCommand,
        type: 'command',
      };

      if (editingCommand._id) {
        await api.put(`/api/datasets/${editingCommand._id}`, payload);
      } else {
        await api.post('/api/datasets', payload);
      }

      setIsEditing(false);
      setEditingCommand(null);
      fetchCommands();
      onDataChange();
    } catch (error) {
      console.error('Failed to save command:', error);
      alert('Failed to save command configuration');
    }
  };

  const handleUpdateContent = (field: string, value: string) => {
    if (!editingCommand) return;

    setEditingCommand({
      ...editingCommand,
      content: {
        ...editingCommand.content,
        [editLanguage]: {
          ...(editingCommand.content?.[editLanguage] || {}),
          [field]: value,
        },
      },
    });
  };

  const getCommandStatus = (name: string): CommandConfig | undefined => {
    return commands.find((c) => c.name === name || c.key === `COMMAND_${name.toUpperCase()}`);
  };

  const getTranslatedLanguages = (command: CommandConfig): Language[] => {
    const translated: Language[] = [];
    if (command.content?.en?.message) translated.push('en');
    if (command.content?.si?.message) translated.push('si');
    if (command.content?.ta?.message) translated.push('ta');
    return translated;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (isEditing && editingCommand) {
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Edit Command: !{editingCommand.name}</h2>
          <button onClick={() => setIsEditing(false)} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Command Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">
              <strong>Command:</strong> !{editingCommand.name}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              <strong>Description:</strong> {editingCommand.description || 'No description'}
            </p>
          </div>

          {/* Language Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Edit response for:</span>
            <LanguageSwitcher
              currentLanguage={editLanguage}
              onLanguageChange={setEditLanguage}
              translatedLanguages={getTranslatedLanguages(editingCommand)}
              size="sm"
            />
          </div>

          {/* Response Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Response Message ({editLanguage.toUpperCase()})
            </label>
            <textarea
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingCommand.content?.[editLanguage]?.message || ''}
              onChange={(e) => handleUpdateContent('message', e.target.value)}
              placeholder={`Enter the response message in ${editLanguage.toUpperCase()}...`}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Command Description ({editLanguage.toUpperCase()})
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingCommand.content?.[editLanguage]?.description || ''}
              onChange={(e) => handleUpdateContent('description', e.target.value)}
              placeholder="Brief description shown in help"
            />
          </div>

          {/* Aliases */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aliases</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={editingCommand.metadata?.aliases?.join(', ') || ''}
              onChange={(e) =>
                setEditingCommand({
                  ...editingCommand,
                  metadata: {
                    ...editingCommand.metadata,
                    aliases: e.target.value.split(',').map((a) => a.trim()).filter(Boolean),
                  },
                })
              }
              placeholder="e.g., h, assist (comma-separated)"
            />
            <p className="text-xs text-gray-500 mt-1">Alternative names for this command</p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Save className="h-4 w-4" /> Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-gray-600 text-sm mb-4">
        Configure bot commands - enable/disable and customize responses in multiple languages.
      </p>

      <div className="space-y-2">
        {defaultCommands.map((defaultCmd) => {
          const config = getCommandStatus(defaultCmd.name);
          const isActive = config?.isActive !== false; // Default to true if not configured
          const translated = config ? getTranslatedLanguages(config) : [];

          return (
            <div
              key={defaultCmd.name}
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-blue-600 font-medium">!{defaultCmd.name}</span>
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      isActive
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {isActive ? 'Enabled' : 'Disabled'}
                  </span>
                  {translated.length > 0 && (
                    <div className="flex items-center gap-1">
                      {translated.map((lang) => (
                        <span
                          key={lang}
                          className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-xs rounded"
                        >
                          {lang.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {config?.description || defaultCmd.description}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    handleEdit(
                      config || {
                        _id: '',
                        name: defaultCmd.name,
                        description: defaultCmd.description,
                        content: {},
                        isActive: true,
                      }
                    )
                  }
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                >
                  <Edit className="h-4 w-4" />
                </button>
                <button
                  onClick={() =>
                    handleToggle(
                      config || {
                        _id: '',
                        name: defaultCmd.name,
                        description: defaultCmd.description,
                        content: {},
                        isActive: true,
                      }
                    )
                  }
                  className="p-2 text-gray-400 hover:text-blue-600"
                >
                  {isActive ? (
                    <ToggleRight className="h-6 w-6 text-green-600" />
                  ) : (
                    <ToggleLeft className="h-6 w-6" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}