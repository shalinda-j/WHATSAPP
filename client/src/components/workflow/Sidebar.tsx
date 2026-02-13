import { useState, type DragEvent } from 'react';
import {
    MessageSquare, Bot, Send, GitBranch,
    ChevronDown, ChevronRight, Search
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

    // Group integrations by category
    const integrationsByCategory = Object.values(INTEGRATIONS).reduce((acc, integration) => {
        const cat = integration.category || 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(integration);
        return acc;
    }, {} as Record<string, IntegrationPreset[]>);

    // Filter based on search
    const filteredCategories = Object.keys(integrationsByCategory).filter(cat => {
        if (!searchTerm) return true;
        const hasMatch = integrationsByCategory[cat].some(i => i.label.toLowerCase().includes(searchTerm.toLowerCase()));
        return hasMatch;
    });

    return (
        <aside className="border-r border-gray-200 bg-gray-50 flex flex-col w-72 h-full shrink-0 font-sans shadow-lg z-20">

            {/* Search Header */}
            <div className="p-4 border-b border-gray-200 bg-white">
                <h2 className="text-lg font-bold text-gray-800 mb-3">Workflow Nodes</h2>
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                    <input
                        type="text"
                        placeholder="Search tools..."
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">

                {/* CORE ACTIONS */}
                <div>
                    <div className="mb-2 flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Core Actions</span>
                    </div>
                    <div className="space-y-2">
                        <div className="bg-white p-3 border border-gray-200 rounded-lg cursor-grab shadow-sm flex items-center gap-3 hover:border-green-500 hover:shadow-md transition-all group"
                            onDragStart={(event) => onDragStart(event, 'input', 'WhatsApp Trigger')}
                            draggable>
                            <div className="p-1.5 bg-green-100 rounded text-green-600 group-hover:bg-green-200 transition-colors">
                                <MessageSquare size={16} />
                            </div>
                            <span className="text-sm font-medium text-gray-700">WhatsApp Trigger</span>
                        </div>

                        <div className="bg-white p-3 border border-gray-200 rounded-lg cursor-grab shadow-sm flex items-center gap-3 hover:border-purple-500 hover:shadow-md transition-all group"
                            onDragStart={(event) => onDragStart(event, 'default', 'AI Processing')}
                            draggable>
                            <div className="p-1.5 bg-purple-100 rounded text-purple-600 group-hover:bg-purple-200 transition-colors">
                                <Bot size={16} />
                            </div>
                            <span className="text-sm font-medium text-gray-700">AI Processing</span>
                        </div>

                        <div className="bg-white p-3 border border-gray-200 rounded-lg cursor-grab shadow-sm flex items-center gap-3 hover:border-blue-500 hover:shadow-md transition-all group"
                            onDragStart={(event) => onDragStart(event, 'default', 'Decision')}
                            draggable>
                            <div className="p-1.5 bg-blue-100 rounded text-blue-600 group-hover:bg-blue-200 transition-colors">
                                <GitBranch size={16} />
                            </div>
                            <span className="text-sm font-medium text-gray-700">Decision Logic</span>
                        </div>

                        <div className="bg-white p-3 border border-gray-200 rounded-lg cursor-grab shadow-sm flex items-center gap-3 hover:border-indigo-500 hover:shadow-md transition-all group"
                            onDragStart={(event) => onDragStart(event, 'output', 'Send Reply')}
                            draggable>
                            <div className="p-1.5 bg-indigo-100 rounded text-indigo-600 group-hover:bg-indigo-200 transition-colors">
                                <Send size={16} />
                            </div>
                            <span className="text-sm font-medium text-gray-700">Send Whatsapp</span>
                        </div>
                    </div>
                </div>

                {/* INTEGRATIONS CATEGORIES */}
                {filteredCategories.map(category => (
                    <div key={category}>
                        <button
                            onClick={() => toggleCategory(category)}
                            className="flex items-center justify-between w-full mb-2 group text-left"
                        >
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider group-hover:text-blue-600 transition-colors">
                                {category} Integration
                            </span>
                            {openCategories[category] || searchTerm ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                        </button>

                        {(openCategories[category] || searchTerm) && (
                            <div className="space-y-2 pl-1">
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
                                                <div className="p-1.5 bg-gray-100 rounded text-gray-600 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                                                    <Icon size={16} />
                                                </div>
                                                <span className="text-xs font-medium text-gray-700">{integration.label}</span>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>
                ))}

            </div>

            {/* Footer info */}
            <div className="p-3 bg-gray-100 text-[10px] text-gray-500 text-center border-t border-gray-200">
                Showing top 50+ integrations
            </div>
        </aside>
    );
};

export default Sidebar;
