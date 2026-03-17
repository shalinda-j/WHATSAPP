import { useState, useEffect, type ChangeEvent } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import { INTEGRATIONS } from '../../config/integrationPresets';
import type { Node } from 'reactflow';

interface SettingsPanelProps {
    selectedNode: Node | null;
    setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
    onClose: () => void;
}

const SettingsPanel = ({ selectedNode, setNodes, onClose }: SettingsPanelProps) => {
    const [label, setLabel] = useState('');
    const [configValues, setConfigValues] = useState<Record<string, string>>({});

    // Sync node data to local state when selection changes
    // This is a legitimate pattern for syncing props to state for editable form inputs
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (selectedNode) {
            setLabel(selectedNode.data.label || '');
            // Initialize config values from node data
            const initialConfig: Record<string, string> = {};

            // Load existing data
            Object.keys(selectedNode.data).forEach(key => {
                if (key !== 'label' && key !== 'integrationType') {
                    initialConfig[key] = selectedNode.data[key];
                }
            });

            setConfigValues(initialConfig);
        }
    }, [selectedNode]);
    /* eslint-enable react-hooks/set-state-in-effect */

    if (!selectedNode) return null;

    const handleSave = () => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === selectedNode.id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            label,
                            ...configValues,
                        },
                    };
                }
                return node;
            })
        );
        onClose();
    };

    const handleDelete = () => {
        setNodes((nds) => nds.filter((node) => node.id !== selectedNode.id));
        onClose();
    };

    // Determine fields based on integration type
    let fields = [{ key: 'config', label: 'Configuration', type: 'text' }];
    let category = 'Node Settings';

    if (selectedNode.data.integrationType) {
        const preset = INTEGRATIONS[selectedNode.data.integrationType];
        if (preset) {
            fields = preset.fields.map(f => ({ ...f, type: f.type || 'text' }));
            category = `${preset.label} Settings`;
        }
    } else if (selectedNode.type === 'input') {
        category = 'Trigger Settings';
        fields = [{ key: 'triggerId', label: 'Trigger ID', type: 'text' }];
    } else if (selectedNode.type === 'output') {
        category = 'Output Settings';
        fields = [{ key: 'message', label: 'Response Message', type: 'text' }];
    }

    return (
        <div className="absolute top-4 right-4 w-80 bg-white shadow-xl rounded-lg border border-gray-200 flex flex-col z-50 animate-in slide-in-from-right-10 duration-200">

            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50 rounded-t-lg">
                <h3 className="font-bold text-gray-800">{category}</h3>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                    <X size={18} />
                </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">

                {/* Label Field */}
                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                        Node Label
                    </label>
                    <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded focus:border-blue-500 focus:outline-none text-sm"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                    />
                </div>

                {/* Dynamic Fields */}
                {fields.map((field) => (
                    <div key={field.key}>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                            {field.label}
                        </label>
                        <input
                            type={field.type || 'text'}
                            className="w-full p-2 border border-gray-300 rounded focus:border-blue-500 focus:outline-none text-sm"
                            placeholder={`Enter ${field.label}`}
                            value={configValues[field.key] || ''}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                setConfigValues(prev => ({ ...prev, [field.key]: e.target.value }));
                            }}
                        />
                    </div>
                ))}

                <div className="pt-2 text-xs text-gray-400">
                    ID: <span className="font-mono">{selectedNode.id}</span>
                </div>

            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-lg flex justify-between gap-3">
                <button
                    onClick={handleDelete}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors text-sm font-medium w-full"
                >
                    <Trash2 size={16} />
                    Delete
                </button>
                <button
                    onClick={handleSave}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium w-full"
                >
                    <Save size={16} />
                    Save
                </button>
            </div>
        </div>
    );
};

export default SettingsPanel;
