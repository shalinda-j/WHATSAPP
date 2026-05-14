import {
  useCallback,
  useRef,
  useState,
  useEffect,
  type DragEvent,
} from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  type ReactFlowInstance,
} from 'reactflow';
import type { Connection, Edge, Node, NodeChange, EdgeChange } from 'reactflow';
import 'reactflow/dist/style.css';

import Sidebar from './Sidebar';
import IntegrationNode from './CustomNodes/IntegrationNode';
import DecisionNode from './CustomNodes/DecisionNode';
import SettingsPanel from './SettingsPanel';
import { useWorkflow } from './WorkflowContext';

const nodeTypes = {
  integration: IntegrationNode,
  decisionNode: DecisionNode,
};

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

const syncIdCounter = (nodes: Node[]) => {
  for (const node of nodes) {
    const match = node.id.match(/dndnode_(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= id) {
        id = num + 1;
      }
    }
  }
};

const WorkflowBuilder = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const { actions: workflowActions, state: workflowState } = useWorkflow();

  // Watch for pendingLoad — this is how external loads (import, saved workflow, undo/redo) reach the canvas
  useEffect(() => {
    if (workflowState.pendingLoad) {
      setNodes(workflowState.pendingLoad.nodes);
      setEdges(workflowState.pendingLoad.edges);
      syncIdCounter(workflowState.pendingLoad.nodes);
      setSelectedNode(null);
      workflowActions.clearPendingLoad();
    }
  }, [workflowState.pendingLoad, workflowActions, setNodes, setEdges]);

  // Sync local nodes/edges state UP to context on change
  useEffect(() => {
    workflowActions.setNodes(nodes);
  }, [nodes, workflowActions]);

  useEffect(() => {
    workflowActions.setEdges(edges);
  }, [edges, workflowActions]);

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      setEdges((eds) => addEdge(params, eds));
      workflowActions.saveToHistory();
    },
    [setEdges, workflowActions],
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
      const integrationType = event.dataTransfer.getData(
        'application/reactflow/integrationType',
      );

      if (typeof type === 'undefined' || !type) return;
      if (!reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: getId(),
        type,
        position,
        data: {
          label: label || `${type} node`,
          ...(integrationType ? { integrationType } : {}),
        },
      };

      setNodes((nds) => nds.concat(newNode));
      workflowActions.saveToHistory();
    },
    [reactFlowInstance, setNodes, workflowActions],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node);
      workflowActions.setSelectedNode(node);
    },
    [workflowActions],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    workflowActions.setSelectedNode(null);
  }, [workflowActions]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) {
        workflowActions.saveToHistory();
      }
    },
    [onNodesChange, workflowActions],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) {
        workflowActions.saveToHistory();
      }
    },
    [onEdgesChange, workflowActions],
  );

  // When settings panel saves a node, update the selected node reference too
  const handleNodeSaved = useCallback(
    (updatedNode: Node) => {
      setSelectedNode(updatedNode);
      workflowActions.setSelectedNode(updatedNode);
    },
    [workflowActions],
  );

  return (
    <div className="flex flex-row h-full w-full bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200 relative">
      <ReactFlowProvider>
        <Sidebar />
        <div
          className="flex-grow h-full relative bg-gray-50"
          ref={reactFlowWrapper}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
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
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#e5e7eb"
            />
            <MiniMap className="bg-white shadow-md border border-gray-200 rounded-lg zoomable pannable" />
          </ReactFlow>
        </div>
        {selectedNode && (
          <SettingsPanel
            selectedNode={selectedNode}
            setNodes={setNodes}
            onClose={() => {
              setSelectedNode(null);
              workflowActions.setSelectedNode(null);
            }}
            onSaved={handleNodeSaved}
          />
        )}
      </ReactFlowProvider>
    </div>
  );
};

export default WorkflowBuilder;
