import { useState, useEffect, type ChangeEvent } from 'react';
import { X, Save, Trash2, Info } from 'lucide-react';
import { INTEGRATIONS } from '../../config/integrationPresets';
import type { Node } from 'reactflow';

interface SettingsPanelProps {
    selectedNode: Node | null;
    setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
    onClose: () => void;
    onSaved?: (updatedNode: Node) => void;
}

interface FieldDef {
    key: string;
    label: string;
    type: 'text' | 'password' | 'url' | 'textarea';
    placeholder?: string;
    required?: boolean;
    hint?: string;
}

const SettingsPanel = ({ selectedNode, setNodes, onClose, onSaved }: SettingsPanelProps) => {
    const [label, setLabel] = useState('');
    const [configValues, setConfigValues] = useState<Record<string, string>>({});

    useEffect(() => {
        if (selectedNode) {
            setLabel(selectedNode.data.label || '');
            const initialConfig: Record<string, string> = {};
            Object.keys(selectedNode.data).forEach(key => {
                if (key !== 'label' && key !== 'integrationType') {
                    const val = selectedNode.data[key];
                    if (typeof val === 'string') {
                        initialConfig[key] = val;
                    }
                }
            });
            setConfigValues(initialConfig);
        }
    }, [selectedNode]);

    if (!selectedNode) return null;

    // Derive fields and title from node type
    let fields: FieldDef[] = [];
    let panelTitle = 'Node Settings';
    let panelColor = 'bg-gray-50';

    const nodeType = selectedNode.type;
    const integrationType = selectedNode.data.integrationType;

    if (integrationType && INTEGRATIONS[integrationType]) {
        const preset = INTEGRATIONS[integrationType];
        panelTitle = `${preset.label} Settings`;
        panelColor = 'bg-indigo-50';
        fields = preset.fields.map(f => ({
            key: f.key,
            label: f.label,
            type: f.type || 'text',
            placeholder: f.placeholder || `Enter ${f.label}`,
        }));
    } else if (nodeType === 'input') {
        panelTitle = 'Trigger Settings';
        panelColor = 'bg-green-50';
        fields = [
            {
                key: 'triggerKeyword',
                label: 'Trigger Keyword',
                type: 'text',
                placeholder: 'e.g. !start or leave empty for all messages',
                hint: 'WhatsApp message that activates this workflow',
            },
            {
                key: 'sessionFilter',
                label: 'Session Filter',
                type: 'text',
                placeholder: 'e.g. default (leave empty for all)',
                hint: 'Only trigger from this WhatsApp session',
            },
        ];
    } else if (nodeType === 'output') {
        panelTitle = 'Send WhatsApp Settings';
        panelColor = 'bg-indigo-50';
        fields = [
            {
                key: 'message',
                label: 'Message',
                type: 'textarea',
                placeholder: 'Enter the message to send...\nUse {{variable}} for dynamic values',
                required: true,
                hint: 'Message sent to the user. Supports {{aiResponse}}, {{name}}, etc.',
            },
            {
                key: 'recipient',
                label: 'Recipient (optional)',
                type: 'text',
                placeholder: 'Leave empty to reply to sender',
                hint: 'Phone number or leave empty to auto-reply',
            },
        ];
    } else if (nodeType === 'decisionNode') {
        panelTitle = 'Decision / Condition Settings';
        panelColor = 'bg-blue-50';
        fields = [
            {
                key: 'condition',
                label: 'Condition Expression',
                type: 'textarea',
                placeholder: 'e.g. variables.score > 50\nor: triggerData.message === "yes"\nor: variables.aiResponse.includes("interest")',
                required: true,
                hint: 'JavaScript expression. Use variables.xxx or triggerData.xxx. Returns YES (true) or NO (false).',
            },
            {
                key: 'description',
                label: 'Description (optional)',
                type: 'text',
                placeholder: 'Describe what this check does',
            },
        ];
    } else if (nodeType === 'default') {
        // Generic default node - figure out from label
        const lbl = (selectedNode.data.label || '').toLowerCase();
        if (lbl.includes('ai') || lbl.includes('processing')) {
            panelTitle = 'AI Processing Settings';
            panelColor = 'bg-purple-50';
            fields = [
                {
                    key: 'prompt',
                    label: 'System Prompt (optional)',
                    type: 'textarea',
                    placeholder: 'e.g. You are a helpful sales assistant. Be concise.',
                    hint: 'Override the default AI system prompt for this node',
                },
                {
                    key: 'outputVar',
                    label: 'Output Variable Name',
                    type: 'text',
                    placeholder: 'e.g. aiResponse (default)',
                    hint: 'Store AI output in this variable for downstream nodes',
                },
            ];
        } else if (lbl.includes('wait') || lbl.includes('delay')) {
            panelTitle = 'Wait / Delay Settings';
            panelColor = 'bg-orange-50';
            fields = [
                {
                    key: 'delaySeconds',
                    label: 'Delay (seconds)',
                    type: 'text',
                    placeholder: 'e.g. 3600 (for 1 hour)',
                    hint: 'How long to pause before the next step',
                },
            ];
        } else if (lbl.includes('tag')) {
            panelTitle = 'Tag Contact Settings';
            panelColor = 'bg-rose-50';
            fields = [
                {
                    key: 'tag',
                    label: 'Tag Name',
                    type: 'text',
                    placeholder: 'e.g. interested, customer, lead',
                    required: true,
                },
            ];
        } else {
            panelTitle = 'Node Settings';
            fields = [
                {
                    key: 'config',
                    label: 'Configuration',
                    type: 'text',
                    placeholder: 'Enter configuration...',
                },
            ];
        }
    }

    const handleSave = () => {
        let updatedNode: Node | null = null;
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === selectedNode.id) {
                    const updated = {
                        ...node,
                        data: {
                            ...node.data,
                            label,
                            ...configValues,
                        },
                    };
                    updatedNode = updated;
                    return updated;
                }
                return node;
            })
        );
        if (updatedNode && onSaved) {
            onSaved(updatedNode);
        }
        onClose();
    };

    const handleDelete = () => {
        setNodes((nds) => nds.filter((node) => node.id !== selectedNode.id));
        onClose();
    };

    return (
        <div className="absolute top-0 right-0 bottom-0 w-80 bg-white shadow-2xl flex flex-col z-50 border-l border-gray-200">

            {/* Header */}
            <div className={`flex items-center justify-between p-4 border-b border-gray-200 ${panelColor}`}>
                <div>
                    <h3 className="font-bold text-gray-800 text-sm">{panelTitle}</h3>
                    <p className="text-[10px] text-gray-500 font-mono mt-0.5">ID: {selectedNode.id}</p>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4 flex-1 overflow-y-auto">

                {/* Label Field */}
                <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                        Node Label
                    </label>
                    <input
                        type="text"
                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 text-sm transition-all"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                    />
                </div>

                {/* Dynamic Fields */}
                {fields.map((field) => (
                    <div key={field.key}>
                        <label className="flex items-center gap-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                            {field.label}
                            {field.required && <span className="text-red-500">*</span>}
                        </label>

                        {field.type === 'textarea' ? (
                            <textarea
                                className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 text-sm font-mono resize-y transition-all"
                                placeholder={field.placeholder}
                                rows={4}
                                value={configValues[field.key] || ''}
                                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                                    setConfigValues(prev => ({ ...prev, [field.key]: e.target.value }));
                                }}
                            />
                        ) : (
                            <input
                                type={field.type || 'text'}
                                className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 text-sm transition-all"
                                placeholder={field.placeholder}
                                value={configValues[field.key] || ''}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                    setConfigValues(prev => ({ ...prev, [field.key]: e.target.value }));
                                }}
                            />
                        )}

                        {field.hint && (
                            <div className="flex items-start gap-1.5 mt-1.5">
                                <Info size={11} className="text-gray-400 mt-0.5 shrink-0" />
                                <p className="text-[10px] text-gray-400 leading-relaxed">{field.hint}</p>
                            </div>
                        )}
                    </div>
                ))}

            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex gap-2">
                <button
                    onClick={handleDelete}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium"
                >
                    <Trash2 size={14} />
                    Delete
                </button>
                <button
                    onClick={handleSave}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                    <Save size={14} />
                    Save Settings
                </button>
            </div>
        </div>
    );
};

export default SettingsPanel;
