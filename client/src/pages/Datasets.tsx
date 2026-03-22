import { useState, useEffect } from 'react';
import { Database, Terminal, Link, Megaphone, FileText, Bot, Plus } from 'lucide-react';
import { api } from '../config';
import LanguageSwitcher, { Language } from '../components/datasets/LanguageSwitcher';
import KnowledgeTab from '../components/datasets/KnowledgeTab';
import CommandsTab from '../components/datasets/CommandsTab';
import LinksTab from '../components/datasets/LinksTab';
import MarketingTab from '../components/datasets/MarketingTab';
import MegaTextTab from '../components/datasets/MegaTextTab';
import AIPersonalityTab from '../components/datasets/AIPersonalityTab';

type TabType = 'knowledge' | 'commands' | 'links' | 'marketing' | 'megatext' | 'personality';

interface Tab {
  id: TabType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const tabs: Tab[] = [
  { id: 'knowledge', label: 'Knowledge Base', icon: Database },
  { id: 'commands', label: 'Commands', icon: Terminal },
  { id: 'links', label: 'Links', icon: Link },
  { id: 'marketing', label: 'Marketing Agent', icon: Megaphone },
  { id: 'megatext', label: 'Mega Text', icon: FileText },
  { id: 'personality', label: 'AI Personality', icon: Bot },
];

export default function Datasets() {
  const [activeTab, setActiveTab] = useState<TabType>('knowledge');
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');
  const [counts, setCounts] = useState<Record<TabType, number>>({
    knowledge: 0,
    commands: 0,
    links: 0,
    marketing: 0,
    megatext: 0,
    personality: 0,
  });

  // Fetch counts for each tab
  const fetchCounts = async () => {
    try {
      const res = await api.get('/api/datasets');
      const datasets = res.data;

      const newCounts: Record<TabType, number> = {
        knowledge: 0,
        commands: 0,
        links: 0,
        marketing: 0,
        megatext: 0,
        personality: 0,
      };

      datasets.forEach((ds: any) => {
        const type = ds.type || 'knowledge';
        if (newCounts[type as TabType] !== undefined) {
          newCounts[type as TabType]++;
        }
      });

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
        return <KnowledgeTab language={currentLanguage} onDataChange={handleDataChange} />;
      case 'commands':
        return <CommandsTab language={currentLanguage} onDataChange={handleDataChange} />;
      case 'links':
        return <LinksTab language={currentLanguage} onDataChange={handleDataChange} />;
      case 'marketing':
        return <MarketingTab language={currentLanguage} onDataChange={handleDataChange} />;
      case 'megatext':
        return <MegaTextTab language={currentLanguage} onDataChange={handleDataChange} />;
      case 'personality':
        return <AIPersonalityTab language={currentLanguage} onDataChange={handleDataChange} />;
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
                  ${isActive
                    ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {count > 0 && (
                  <span className={`
                    px-2 py-0.5 rounded-full text-xs font-semibold
                    ${isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
                  `}>
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