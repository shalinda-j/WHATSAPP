import { memo, useCallback, type ChangeEvent } from 'react';
import { Handle, Position, type NodeProps, useReactFlow } from 'reactflow';
import { INTEGRATIONS } from '../../../config/integrationPresets';
import { Globe } from 'lucide-react';

const IntegrationNode = ({ id, data, isConnectable }: NodeProps) => {
  const { setNodes } = useReactFlow();

  // Determine which preset to use based on data.integrationType
  const presetId = data.integrationType;
  const preset = INTEGRATIONS[presetId];

  // Fallback if preset not found (generic)
  const Icon = preset?.icon || Globe;
  const label = preset?.label || data.label || 'Integration';
  const fields = preset?.fields || [
    { key: 'config', label: 'Configuration', type: 'text' },
  ];

  const handleChange = useCallback(
    (fieldKey: string, value: string) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: { ...node.data, [fieldKey]: value },
            };
          }
          return node;
        }),
      );
    },
    [id, setNodes],
  );

  return (
    <div className="bg-white border-2 border-slate-200 rounded-lg p-3 shadow-md min-w-[220px] hover:border-indigo-500 transition-colors">
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        className="w-3 h-3 bg-slate-400"
      />

      <div className="flex items-center gap-2 mb-3 border-b border-gray-100 pb-2">
        <div className="p-1.5 bg-slate-50 rounded-md text-indigo-600">
          <Icon size={18} />
        </div>
        <div>
          <span className="block font-bold text-sm text-slate-700 leading-tight">
            {label}
          </span>
          <span className="text-[10px] text-slate-400 uppercase tracking-wide">
            {preset?.category || 'Custom'}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`field-${id}-${field.key}`}
              className="block text-[10px] uppercase font-semibold text-slate-500 mb-1"
            >
              {field.label}
            </label>
            <input
              id={`field-${id}-${field.key}`}
              name={field.key}
              className="nodrag w-full text-xs p-2 rounded border border-gray-300 focus:outline-none focus:border-indigo-500 bg-gray-50 focus:bg-white transition-all"
              placeholder={field.placeholder || `Enter ${field.label}`}
              type={field.type || 'text'}
              value={data[field.key] ?? ''}
              onChange={(evt: ChangeEvent<HTMLInputElement>) => {
                handleChange(field.key, evt.target.value);
              }}
            />
          </div>
        ))}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        className="w-3 h-3 bg-slate-400"
      />
    </div>
  );
};

export default memo(IntegrationNode);
