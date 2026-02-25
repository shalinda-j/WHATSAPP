import { useCallback, useRef, useState, useMemo, type DragEvent } from 'react';
import ReactFlow, {
    ReactFlowProvider,
    addEdge,
    useNodesState,
    useEdgesState,
    Controls,
    Background,
    BackgroundVariant,
    MiniMap
} from 'reactflow';
import type { Connection, Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';

import Sidebar from './Sidebar';
import IntegrationNode from './CustomNodes/IntegrationNode';
import SettingsPanel from './SettingsPanel';

// Memoize nodeTypes to prevent recreation on every render
const nodeTypes = useMemo(() => ({
    integration: IntegrationNode,
}), []);

const initialNodes: Node[] = [
    {
        id: '1',
        type: 'input',
        data: { label: 'Start Workflow' },
        position: { x: 250, y: 5 },
    },
];

let id = 0;
const getId = () => `dndnode_${id++}`;

const WorkflowBuilder = () => {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);

    const onConnect = useCallback(
        (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
        [setEdges],
    );

    const onDragOver = useCallback((event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/reactflow/type');
            const label = event.dataTransfer.getData('application/reactflow/label');
            const integrationType = event.dataTransfer.getData('application/reactflow/integrationType');

            // check if the dropped element is valid
            if (typeof type === 'undefined' || !type) {
                return;
            }

            // Check if instance is ready
            if (!reactFlowInstance) return;

            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            const newNode: Node = {
                id: getId(),
                type, // Use the mapped type (input, default, output)
                position,
                data: {
                    label: label || `${type} node`,
                    integrationType // Pass this to the custom node
                },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes],
    );

    const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedNode(node);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    return (
        <div className="flex flex-row h-full w-full bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200 relative">
            <ReactFlowProvider>
                <Sidebar />
                <div className="flex-grow h-full relative bg-gray-50" ref={reactFlowWrapper}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onInit={setReactFlowInstance}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        onNodeDoubleClick={onNodeDoubleClick}
                        onPaneClick={onPaneClick}
                        nodeTypes={nodeTypes}
                        deleteKeyCode={['Backspace', 'Delete']}
                        fitView
                        attributionPosition="bottom-right"
                    >
                        <Controls className="bg-white shadow-md border border-gray-200 rounded-lg" />
                        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
                        <MiniMap className="bg-white shadow-md border border-gray-200 rounded-lg" zoomable pannable />
                    </ReactFlow>
                </div>
                {selectedNode && (
                    <SettingsPanel
                        selectedNode={selectedNode}
                        setNodes={setNodes}
                        onClose={() => setSelectedNode(null)}
                    />
                )}
            </ReactFlowProvider>
        </div>
    );
};

export default WorkflowBuilder;
