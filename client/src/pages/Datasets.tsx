import { useState, useEffect } from 'react';
import {
  Database,
  Terminal,
  Link,
  FileText,
  Bot,
  MessageSquare,
  GraduationCap,
  ClipboardList,
} from 'lucide-react';
import { api } from '../config';
import LanguageSwitcher, {
  type Language,
} from '../components/datasets/LanguageSwitcher';
import KnowledgeTab from '../components/datasets/KnowledgeTab';
import CommandsTab from '../components/datasets/CommandsTab';
import LinksTab from '../components/datasets/LinksTab';
// Marketing tab removed
import MegaTextTab from '../components/datasets/MegaTextTab';
import AIPersonalityTab from '../components/datasets/AIPersonalityTab';
import AcknowledgementsTab from '../components/datasets/AcknowledgementsTab';
import SkillsTab from '../components/datasets/SkillsTab';
import FormsTab from '../components/datasets/FormsTab';

type TabType =
  | 'knowledge'
  | 'commands'
  | 'links'
  | 'megatext'
  | 'personality'
  | 'acknowledgements'
  | 'skills'
  | 'forms';

interface Tab {
  id: TabType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const tabs: Tab[] = [
  { id: 'knowledge', label: 'Knowledge Base', icon: Database },
  { id: 'commands', label: 'Commands', icon: Terminal },
  { id: 'links', label: 'Links', icon: Link },
  // Marketing tab removed
  { id: 'megatext', label: 'Mega Text', icon: FileText },
  { id: 'personality', label: 'AI Personality', icon: Bot },
  { id: 'acknowledgements', label: 'Acknowledgements', icon: MessageSquare },
  { id: 'skills', label: 'Skills', icon: GraduationCap },
  { id: 'forms', label: 'Forms', icon: ClipboardList },
];

export default function Datasets() {
  const [activeTab, setActiveTab] = useState<TabType>('knowledge');
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');
  const [counts, setCounts] = useState<Record<TabType, number>>({
    knowledge: 0,
    commands: 0,
    links: 0,
    megatext: 0,
    personality: 0,
    acknowledgements: 0,
    skills: 0,
    forms: 0,
  });

  // Fetch counts for each tab
  const fetchCounts = async () => {
    try {
      const res = await api.get('/api/datasets');
      const datasets = Array.isArray(res.data)
        ? res.data
        : res.data?.datasets || res.data?.data || [];

      const newCounts: Record<TabType, number> = {
        knowledge: 0,
        commands: 0,
        links: 0,
        megatext: 0,
        personality: 0,
        acknowledgements: 0,
        skills: 0,
        forms: 0,
      };

      // Filter out 'config' type (internal configuration items, not displayed in tabs)
      datasets
        .filter((ds: Record<string, unknown>) => ds.type !== 'config')
        .forEach((ds: Record<string, unknown>) => {
          const type = (ds.type as string) || 'knowledge';
          const typeMap: Record<string, TabType> = {
            knowledge: 'knowledge',
            command: 'commands',
            link: 'links',
            megatext: 'megatext',
            personality: 'personality',
          };
          // Acknowledgements live under type='personality' but with key='ACKNOWLEDGEMENTS'.
          // Route them to the acknowledgements tab so the count is accurate.
          if (
            type === 'personality' &&
            (ds.key as string) === 'ACKNOWLEDGEMENTS'
          ) {
            newCounts.acknowledgements++;
            return;
          }
          const tabType = typeMap[type];
          if (tabType) {
            newCounts[tabType]++;
          }
        });

      // Skills live in a separate collection (agent_skills), not under
      // /api/datasets — fetch them in parallel so the tab badge stays
      // accurate.
      try {
        const skillsRes = await api.get('/api/agent-skills');
        const skillsArr =
          (skillsRes.data?.skills as unknown[]) ??
          (Array.isArray(skillsRes.data) ? skillsRes.data : []);
        newCounts.skills = Array.isArray(skillsArr) ? skillsArr.length : 0;
      } catch {
        /* skills count is informational — non-fatal */
      }

      // Auto-learned Q/A rows live in the KnowledgeEntry collection
      // (separate from Dataset). Roll their count into the Knowledge tab
      // badge so the total matches what the merged Knowledge tab shows.
      try {
        const kbRes = await api.get('/api/knowledge');
        const kbArr = Array.isArray(kbRes.data)
          ? kbRes.data
          : kbRes.data?.entries ?? [];
        newCounts.knowledge += Array.isArray(kbArr) ? kbArr.length : 0;
      } catch {
        /* /api/knowledge missing on older builds is non-fatal */
      }

      // Forms tab reads from /api/forms/templates (FormTemplate collection),
      // not /api/datasets.
      try {
        const formsRes = await api.get('/api/forms/templates');
        const formsArr = Array.isArray(formsRes.data)
          ? formsRes.data
          : formsRes.data?.templates ?? [];
        newCounts.forms = Array.isArray(formsArr) ? formsArr.length : 0;
      } catch {
        /* forms count non-fatal */
      }

      setCounts(newCounts);
    } catch (error) {
      console.error('Failed to fetch dataset counts:', error);
    }
  };

  useEffect(() => {
    fetchCounts();
  }, []);

  const handleLanguageChange = (lang: Language) => {
    setCurrentLanguage(lang);
  };

  const handleDataChange = () => {
    fetchCounts();
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'knowledge':
        return (
          <KnowledgeTab
            language={currentLanguage}
            onDataChange={handleDataChange}
          />
        );
      case 'commands':
        return (
          <CommandsTab
            language={currentLanguage}
            onDataChange={handleDataChange}
          />
        );
      case 'links':
        return (
          <LinksTab
            language={currentLanguage}
            onDataChange={handleDataChange}
          />
        );
      case 'megatext':
        return (
          <MegaTextTab
            language={currentLanguage}
            onDataChange={handleDataChange}
          />
        );
      case 'personality':
        return (
          <AIPersonalityTab
            language={currentLanguage}
            onDataChange={handleDataChange}
          />
        );
      case 'acknowledgements':
        return (
          <AcknowledgementsTab
            language={currentLanguage}
            onDataChange={handleDataChange}
          />
        );
      case 'skills':
        return (
          <SkillsTab
            language={currentLanguage}
            onDataChange={handleDataChange}
          />
        );
      case 'forms':
        return <FormsTab onDataChange={handleDataChange} />;
      default:
        return null;
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Data Sets</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage AI knowledge, commands, links, and marketing content
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Language Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Language:</span>
            <LanguageSwitcher
              currentLanguage={currentLanguage}
              onLanguageChange={handleLanguageChange}
            />
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
        <div className="flex overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const count = counts[tab.id];

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 font-medium text-sm whitespace-nowrap
                  border-b-2 transition-all
                  ${
                    isActive
                      ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {count > 0 && (
                  <span
                    className={`
                    px-2 py-0.5 rounded-full text-xs font-semibold
                    ${
                      isActive
                        ? 'bg-blue-100 text-blue-600'
                        : 'bg-gray-100 text-gray-600'
                    }
                  `}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl shadow-md p-6">
        {renderTabContent()}
      </div>
    </div>
  );
}
