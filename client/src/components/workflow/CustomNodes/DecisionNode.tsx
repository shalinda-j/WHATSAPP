import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { GitBranch } from 'lucide-react';

const DecisionNode = ({ data, isConnectable }: NodeProps) => {
    return (
        <div className="bg-white border-2 border-blue-300 rounded-xl shadow-md min-w-[210px] hover:border-blue-500 transition-colors">
            <Handle
                type="target"
                position={Position.Top}
                isConnectable={isConnectable}
                className="w-3 h-3 !bg-slate-400"
            />

            {/* Header */}
            <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-blue-100">
                <div className="p-1.5 bg-blue-50 rounded-md text-blue-600 shrink-0">
                    <GitBranch size={16} />
                </div>
                <div className="min-w-0">
                    <span className="block font-bold text-sm text-slate-800 leading-tight truncate">
                        {data.label || 'Decision'}
                    </span>
                    <span className="text-[10px] text-blue-400 uppercase tracking-wide">
                        Condition Check
                    </span>
                </div>
            </div>

            {/* Condition display */}
            <div className="px-3 py-2">
                {data.condition ? (
                    <div className="bg-slate-50 border border-slate-200 rounded p-1.5">
                        <span className="text-[10px] font-mono text-slate-600 break-all leading-relaxed">
                            {data.condition}
                        </span>
                    </div>
                ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded p-1.5">
                        <span className="text-[10px] text-amber-600">
                            Double-click to set condition
                        </span>
                    </div>
                )}
            </div>

            {/* Branch labels */}
            <div className="flex justify-between px-4 pb-3 mt-1">
                <div className="flex flex-col items-center gap-1">
                    <span className="text-[9px] font-bold text-green-600 uppercase tracking-wider">YES</span>
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                </div>
                <div className="flex flex-col items-center gap-1">
                    <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider">NO</span>
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                </div>
            </div>

            {/* YES handle (left) */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="yes"
                style={{ left: '28%', bottom: -6 }}
                isConnectable={isConnectable}
                className="!w-3 !h-3 !bg-green-500"
            />
            {/* NO handle (right) */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="no"
                style={{ left: '72%', bottom: -6 }}
                isConnectable={isConnectable}
                className="!w-3 !h-3 !bg-red-400"
            />
        </div>
    );
};

export default memo(DecisionNode);
