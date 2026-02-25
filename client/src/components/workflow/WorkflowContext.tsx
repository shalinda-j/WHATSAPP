import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';
import type { Node, Edge } from 'reactflow';

// Types
export interface WorkflowState {
  nodes: Node[];
  edges: Edge[];
  selectedNode: Node | null;
  isLoading: boolean;
  error: string | null;
  lastSaved: Date | null;
  isDirty: boolean;
  history: {
    nodes: Node[];
    edges: Edge[];
  }[];
  historyIndex: number;
}

export type WorkflowAction =
  | { type: 'SET_NODES'; payload: Node[] }
  | { type: 'SET_EDGES'; payload: Edge[] }
  | { type: 'ADD_NODE'; payload: Node }
  | { type: 'UPDATE_NODE'; payload: { id: string; data: Partial<Node['data']> } }
  | { type: 'DELETE_NODE'; payload: string }
  | { type: 'SET_SELECTED_NODE'; payload: Node | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_LAST_SAVED'; payload: Date | null }
  | { type: 'SET_DIRTY'; payload: boolean }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SAVE_TO_HISTORY' };

// Initial state
const initialState: WorkflowState = {
  nodes: [],
  edges: [],
  selectedNode: null,
  isLoading: false,
  error: null,
  lastSaved: null,
  isDirty: false,
  history: [],
  historyIndex: -1
};

// Reducer
const workflowReducer = (state: WorkflowState, action: WorkflowAction): WorkflowState => {
  switch (action.type) {
    case 'SET_NODES':
      return { ...state, nodes: action.payload, isDirty: true };
    
    case 'SET_EDGES':
      return { ...state, edges: action.payload, isDirty: true };
    
    case 'ADD_NODE':
      return { 
        ...state, 
        nodes: [...state.nodes, action.payload], 
        isDirty: true 
      };
    
    case 'UPDATE_NODE':
      return {
        ...state,
        nodes: state.nodes.map(node =>
          node.id === action.payload.id
            ? { ...node, data: { ...node.data, ...action.payload.data } }
            : node
        ),
        isDirty: true
      };
    
    case 'DELETE_NODE':
      return {
        ...state,
        nodes: state.nodes.filter(node => node.id !== action.payload),
        edges: state.edges.filter(edge => 
          edge.source !== action.payload && edge.target !== action.payload
        ),
        isDirty: true
      };
    
    case 'SET_SELECTED_NODE':
      return { ...state, selectedNode: action.payload };
    
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    
    case 'SET_LAST_SAVED':
      return { ...state, lastSaved: action.payload, isDirty: false };
    
    case 'SET_DIRTY':
      return { ...state, isDirty: action.payload };
    
    case 'SAVE_TO_HISTORY':
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push({ nodes: state.nodes, edges: state.edges });
      
      // Keep only last 50 states
      if (newHistory.length > 50) {
        newHistory.shift();
      }
      
      return {
        ...state,
        history: newHistory,
        historyIndex: newHistory.length - 1
      };
    
    case 'UNDO':
      if (state.historyIndex > 0) {
        const prevState = state.history[state.historyIndex - 1];
        return {
          ...state,
          nodes: prevState.nodes,
          edges: prevState.edges,
          historyIndex: state.historyIndex - 1,
          isDirty: true
        };
      }
      return state;
    
    case 'REDO':
      if (state.historyIndex < state.history.length - 1) {
        const nextState = state.history[state.historyIndex + 1];
        return {
          ...state,
          nodes: nextState.nodes,
          edges: nextState.edges,
          historyIndex: state.historyIndex + 1,
          isDirty: true
        };
      }
      return state;
    
    default:
      return state;
  }
};

// Context
const WorkflowContext = createContext<{
  state: WorkflowState;
  dispatch: React.Dispatch<WorkflowAction>;
  actions: {
    setNodes: (nodes: Node[]) => void;
    setEdges: (edges: Edge[]) => void;
    addNode: (node: Node) => void;
    updateNode: (id: string, data: Partial<Node['data']>) => void;
    deleteNode: (id: string) => void;
    setSelectedNode: (node: Node | null) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setLastSaved: (date: Date | null) => void;
    saveToHistory: () => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
  };
} | null>(null);

// Provider
export const WorkflowProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(workflowReducer, initialState);

  // Actions
  const actions = {
    setNodes: useCallback((nodes: Node[]) => dispatch({ type: 'SET_NODES', payload: nodes }), []),
    setEdges: useCallback((edges: Edge[]) => dispatch({ type: 'SET_EDGES', payload: edges }), []),
    addNode: useCallback((node: Node) => dispatch({ type: 'ADD_NODE', payload: node }), []),
    updateNode: useCallback((id: string, data: Partial<Node['data']>) => 
      dispatch({ type: 'UPDATE_NODE', payload: { id, data } }), []),
    deleteNode: useCallback((id: string) => dispatch({ type: 'DELETE_NODE', payload: id }), []),
    setSelectedNode: useCallback((node: Node | null) => 
      dispatch({ type: 'SET_SELECTED_NODE', payload: node }), []),
    setLoading: useCallback((loading: boolean) => dispatch({ type: 'SET_LOADING', payload: loading }), []),
    setError: useCallback((error: string | null) => dispatch({ type: 'SET_ERROR', payload: error }), []),
    setLastSaved: useCallback((date: Date | null) => dispatch({ type: 'SET_LAST_SAVED', payload: date }), []),
    saveToHistory: useCallback(() => dispatch({ type: 'SAVE_TO_HISTORY' }), []),
    undo: useCallback(() => dispatch({ type: 'UNDO' }), []),
    redo: useCallback(() => dispatch({ type: 'REDO' }), []),
    canUndo: state.historyIndex > 0,
    canRedo: state.historyIndex < state.history.length - 1
  };

  return (
    <WorkflowContext.Provider value={{ state, dispatch, actions }}>
      {children}
    </WorkflowContext.Provider>
  );
};

// Hook
export const useWorkflow = () => {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error('useWorkflow must be used within a WorkflowProvider');
  }
  return context;
};
