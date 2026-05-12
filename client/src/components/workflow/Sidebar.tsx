import { useState, type DragEvent } from 'react';
import {
    MessageSquare, Bot, Send, GitBranch,
    ChevronDown, ChevronRight, Search, Clock, Tag
} from 'lucide-react';
import { INTEGRATIONS, type IntegrationPreset } from '../../config/integrationPresets';

const Sidebar = () => {
    const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
        'Social': true,
        'CRM': false,
        'Ads': false,
        'Ecommerce': false,
        'Workflow': false
    });
    const [searchTerm, setSearchTerm] = useState('');

    const onDragStart = (event: DragEvent, nodeType: string, label: string, integrationType?: string) => {
        event.dataTransfer.setData('application/reactflow/type', nodeType);
        event.dataTransfer.setData('application/reactflow/label', label);
        if (integrationType) {
            event.dataTransfer.setData('application/reactflow/integrationType', integrationType);
        }
        event.dataTransfer.effectAllowed = 'move';
    };

    const toggleCategory = (category: string) => {
        setOpenCategories(prev => ({ ...prev, [category]: !prev[category] }));
    };

    const integrationsByCategory = Object.values(INTEGRATIONS).reduce((acc, integration) => {
        const cat = integration.category || 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(integration);
        return acc;
    }, {} as Record<string, IntegrationPreset[]>);

    const filteredCategories = Object.keys(integrationsByCategory).filter(cat => {
        if (!searchTerm) return true;
        return integrationsByCategory[cat].some(i =>
            i.label.toLowerCase().includes(searchTerm.toLowerCase())
        );
    });

    const coreNodes = [
        {
            type: 'input',
            label: 'WhatsApp Trigger',
            description: 'Starts the workflow',
            icon: MessageSquare,
            color: 'green',
        },
        {
            type: 'default',
            label: 'AI Processing',
            description: 'Process with AI',
            icon: Bot,
            color: 'purple',
        },
        {
            type: 'decisionNode',
            label: 'Decision Logic',
            description: 'YES / NO branching',
            icon: GitBranch,
            color: 'blue',
        },
        {
            type: 'default',
            label: 'Wait / Delay',
            description: 'Pause execution',
            icon: Clock,
            color: 'orange',
        },
        {
            type: 'output',
            label: 'Send WhatsApp',
            description: 'Send a message',
            icon: Send,
            color: 'indigo',
        },
        {
            type: 'default',
            label: 'Tag Contact',
            description: 'Add CRM tag',
            icon: Tag,
            color: 'rose',
        },
    ];

    const colorMap: Record<string, { bg: string; text: string; border: string; hover: string }> = {
        green: { bg: 'bg-green-100', text: 'text-green-700', border: 'hover:border-green-500', hover: 'group-hover:bg-green-200' },
        purple: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'hover:border-purple-500', hover: 'group-hover:bg-purple-200' },
        blue: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'hover:border-blue-500', hover: 'group-hover:bg-blue-200' },
        orange: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'hover:border-orange-500', hover: 'group-hover:bg-orange-200' },
        indigo: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'hover:border-indigo-500', hover: 'group-hover:bg-indigo-200' },
        rose: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'hover:border-rose-500', hover: 'group-hover:bg-rose-200' },
    };

    return (
        <aside className="border-r border-gray-200 bg-gray-50 flex flex-col w-72 h-full shrink-0 font-sans shadow-lg z-20">

            {/* Search Header */}
            <div className="p-4 border-b border-gray-200 bg-white">
                <h2 className="text-base font-bold text-gray-800 mb-3">Workflow Nodes</h2>
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-gray-400" size={15} />
                    <input
                        type="text"
                        placeholder="Search tools..."
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">

                {/* CORE ACTIONS */}
                {(!searchTerm || coreNodes.some(n => n.label.toLowerCase().includes(searchTerm.toLowerCase()))) && (
                    <div>
                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Core Actions</span>
                        </div>
                        <div className="space-y-1.5">
                            {coreNodes
                                .filter(n => !searchTerm || n.label.toLowerCase().includes(searchTerm.toLowerCase()))
                                .map((node) => {
                                    const Icon = node.icon;
                                    const colors = colorMap[node.color];
                                    return (
                                        <div
                                            key={node.label}
                                            className={`bg-white p-2.5 border border-gray-200 rounded-lg cursor-grab shadow-sm flex items-center gap-3 ${colors.border} hover:shadow-md transition-all group`}
                                            onDragStart={(event) => onDragStart(event, node.type, node.label)}
                                            draggable
                                        >
                                            <div className={`p-1.5 ${colors.bg} rounded ${colors.hover} transition-colors shrink-0`}>
                                                <Icon size={15} className={colors.text} />
                                            </div>
                                            <div className="min-w-0">
                                                <span className="block text-sm font-semibold text-gray-700 leading-tight">{node.label}</span>
                                                <span className="block text-[10px] text-gray-400 truncate">{node.description}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>
                )}

                {/* INTEGRATIONS CATEGORIES */}
                {filteredCategories.map(category => (
                    <div key={category}>
                        <button
                            onClick={() => toggleCategory(category)}
                            className="flex items-center justify-between w-full mb-2 group text-left"
                        >
                            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider group-hover:text-blue-600 transition-colors">
                                {category} Integration
                            </span>
                            {openCategories[category] || searchTerm
                                ? <ChevronDown size={13} className="text-gray-400" />
                                : <ChevronRight size={13} className="text-gray-400" />
                            }
                        </button>

                        {(openCategories[category] || searchTerm) && (
                            <div className="space-y-1.5 pl-1">
                                {integrationsByCategory[category]
                                    .filter(i => !searchTerm || i.label.toLowerCase().includes(searchTerm.toLowerCase()))
                                    .map((integration) => {
                                        const Icon = integration.icon || GitBranch;
                                        return (
                                            <div
                                                key={integration.id}
                                                className="bg-white p-2.5 border border-gray-200 rounded-lg cursor-grab shadow-sm flex items-center gap-3 hover:border-blue-400 hover:shadow-md transition-all group"
                                                onDragStart={(event) => onDragStart(event, 'integration', integration.label, integration.id)}
                                                draggable
                                            >
                                                <div className="p-1.5 bg-gray-100 rounded text-gray-600 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors shrink-0">
                                                    <Icon size={14} />
                                                </div>
                                                <span className="text-xs font-medium text-gray-700 truncate">{integration.label}</span>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>
                ))}

            </div>

            {/* Footer info */}
            <div className="p-3 bg-gray-100 text-[10px] text-gray-400 text-center border-t border-gray-200">
                Drag nodes onto the canvas to build your workflow
            </div>
        </aside>
    );
};

export default Sidebar;
