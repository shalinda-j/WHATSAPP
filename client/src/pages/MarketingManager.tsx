import { useState, useEffect, useCallback, useRef } from 'react';
import WorkflowBuilder from '../components/workflow/WorkflowBuilder';
import {
    Save, Play, Download, Upload, RotateCcw, FolderOpen,
    ChevronDown, CheckCircle, XCircle, AlertTriangle, Clock,
    Trash2, Copy, X, ChevronRight, Loader2, Plus
} from 'lucide-react';
import { WorkflowProvider, useWorkflow } from '../components/workflow/WorkflowContext';
import { workflowValidation } from '../services/workflowValidation';
import ErrorBoundary from '../components/workflow/ErrorBoundary';
import LoadingState from '../components/workflow/LoadingState';
import { ToastContainer } from '../components/workflow/Toast';

interface Toast {
    id: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
}

interface ExecutionLog {
    timestamp: string;
    nodeId: string;
    level: string;
    message: string;
}

interface ExecutionResult {
    success: boolean;
    executionId: string;
    duration: number;
    logs: ExecutionLog[];
    output: unknown;
    error?: string;
}

interface SavedWorkflow {
    _id?: string;
    id?: string;
    name: string;
    description?: string;
    nodes: unknown[];
    edges: unknown[];
    createdAt?: string;
    updatedAt?: string;
    runCount?: number;
    lastRunAt?: string;
}

function MarketingManagerInner() {
    const { state, actions } = useWorkflow();
    const [workflowName, setWorkflowName] = useState('My Workflow');
    const [editingName, setEditingName] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [validationResult, setValidationResult] = useState<ReturnType<typeof workflowValidation.validateWorkflow> | null>(null);

    // Execution results panel
    const [showExecutionPanel, setShowExecutionPanel] = useState(false);
    const [lastExecution, setLastExecution] = useState<ExecutionResult | null>(null);
    const [executionPanelTab, setExecutionPanelTab] = useState<'logs' | 'output'>('logs');

    // Saved workflows library
    const [showLibrary, setShowLibrary] = useState(false);
    const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>([]);
    const [loadingLibrary, setLoadingLibrary] = useState(false);

    // Current saved workflow ID (for update vs create)
    const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null);

    const nameInputRef = useRef<HTMLInputElement>(null);

    // Validate whenever nodes/edges change
    useEffect(() => {
        const result = workflowValidation.validateWorkflow(state.nodes, state.edges);
        setValidationResult(result);
    }, [state.nodes, state.edges]);

    // Auto-save to localStorage
    useEffect(() => {
        if (!state.isDirty || state.isLoading) return;
        const timer = setTimeout(() => {
            try {
                localStorage.setItem('workflow_autosave', JSON.stringify({
                    name: workflowName,
                    nodes: state.nodes,
                    edges: state.edges,
                    savedAt: new Date().toISOString(),
                }));
            } catch { /* ignore */ }
        }, 2000);
        return () => clearTimeout(timer);
    }, [state.isDirty, state.isLoading, state.nodes, state.edges, workflowName]);

    // Restore auto-save on mount
    useEffect(() => {
        try {
            const raw = localStorage.getItem('workflow_autosave');
            if (raw) {
                const data = JSON.parse(raw);
                if (data.nodes?.length > 0) {
                    actions.loadWorkflow({ nodes: data.nodes, edges: data.edges || [] });
                    if (data.name) setWorkflowName(data.name);
                    addToast('Previous workflow restored from auto-save', 'info');
                }
            }
        } catch { /* ignore */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
        const id = `${Date.now()}_${Math.random()}`;
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // ── Library ──────────────────────────────────────────────────────────────
    const fetchSavedWorkflows = useCallback(async () => {
        setLoadingLibrary(true);
        try {
            const res = await fetch('/api/workflows');
            if (res.ok) {
                const data = await res.json();
                setSavedWorkflows(Array.isArray(data) ? data : []);
            } else {
                // Fall back to localStorage
                const raw = localStorage.getItem('marketing_workflows');
                setSavedWorkflows(raw ? JSON.parse(raw) : []);
            }
        } catch {
            const raw = localStorage.getItem('marketing_workflows');
            setSavedWorkflows(raw ? JSON.parse(raw) : []);
        } finally {
            setLoadingLibrary(false);
        }
    }, []);

    const handleOpenLibrary = useCallback(async () => {
        setShowLibrary(true);
        await fetchSavedWorkflows();
    }, [fetchSavedWorkflows]);

    const handleLoadWorkflow = useCallback((wf: SavedWorkflow) => {
        actions.loadWorkflow({
            nodes: wf.nodes as any[],
            edges: wf.edges as any[],
        });
        setWorkflowName(wf.name);
        setCurrentWorkflowId(wf._id || wf.id || null);
        setShowLibrary(false);
        addToast(`Loaded: ${wf.name}`, 'success');
    }, [actions, addToast]);

    const handleDeleteWorkflow = useCallback(async (wf: SavedWorkflow, e: React.MouseEvent) => {
        e.stopPropagation();
        const id = wf._id || wf.id;
        if (!id) return;
        if (!confirm(`Delete "${wf.name}"?`)) return;

        try {
            await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
        } catch { /* ignore */ }
        // Also remove from localStorage
        try {
            const raw = localStorage.getItem('marketing_workflows');
            if (raw) {
                const list = JSON.parse(raw).filter((w: any) => w.id !== id && w._id !== id);
                localStorage.setItem('marketing_workflows', JSON.stringify(list));
            }
        } catch { /* ignore */ }
        await fetchSavedWorkflows();
        addToast('Workflow deleted', 'info');
    }, [fetchSavedWorkflows, addToast]);

    // ── Save ─────────────────────────────────────────────────────────────────
    const handleSave = useCallback(async () => {
        if (isSaving) return;
        setIsSaving(true);
        actions.setLoading(true);
        try {
            const payload = {
                name: workflowName,
                description: 'Marketing automation workflow',
                nodes: state.nodes,
                edges: state.edges,
                version: '1.0.0',
            };

            let savedId = currentWorkflowId;

            // Try API first
            try {
                const method = currentWorkflowId ? 'PUT' : 'POST';
                const url = currentWorkflowId
                    ? `/api/workflows/${currentWorkflowId}`
                    : '/api/workflows';
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (res.ok) {
                    const saved = await res.json();
                    savedId = saved._id || saved.id;
                    addToast(`✓ Saved to database: ${workflowName}`, 'success');
                } else {
                    throw new Error('API save failed');
                }
            } catch {
                // Fallback: localStorage
                const raw = localStorage.getItem('marketing_workflows');
                const list: any[] = raw ? JSON.parse(raw) : [];
                const existing = list.findIndex(w => w.id === currentWorkflowId);
                const entry = { ...payload, id: currentWorkflowId || `wf_${Date.now()}`, createdAt: new Date().toISOString() };
                if (existing >= 0) list[existing] = entry;
                else list.push(entry);
                savedId = entry.id;
                localStorage.setItem('marketing_workflows', JSON.stringify(list));
                addToast(`Saved locally: ${workflowName}`, 'success');
            }

            setCurrentWorkflowId(savedId);
            actions.setLastSaved(new Date());
        } catch (err) {
            addToast(`Save failed: ${err}`, 'error');
        } finally {
            setIsSaving(false);
            actions.setLoading(false);
        }
    }, [workflowName, state.nodes, state.edges, currentWorkflowId, isSaving, actions, addToast]);

    // ── New Workflow ──────────────────────────────────────────────────────────
    const handleNew = useCallback(() => {
        if (state.isDirty && !confirm('Start a new workflow? Unsaved changes will be lost.')) return;
        const starterNodes = [{
            id: '1',
            type: 'input',
            data: { label: 'Start Workflow' },
            position: { x: 250, y: 50 },
        }];
        actions.loadWorkflow({ nodes: starterNodes, edges: [] });
        setWorkflowName('My Workflow');
        setCurrentWorkflowId(null);
        setLastExecution(null);
        setShowExecutionPanel(false);
    }, [state.isDirty, actions]);

    // ── Run ───────────────────────────────────────────────────────────────────
    const handleRun = useCallback(async () => {
        if (isExecuting) return;

        if (state.nodes.length === 0) {
            addToast('Add some nodes before running the workflow', 'warning');
            return;
        }

        setIsExecuting(true);
        actions.setLoading(true);

        // Show warnings but don't block
        if (validationResult && !validationResult.isValid) {
            validationResult.errors.forEach(e => addToast(`Error: ${e.message}`, 'error'));
            setIsExecuting(false);
            actions.setLoading(false);
            return;
        }

        if (validationResult?.warnings && validationResult.warnings.length > 0) {
            validationResult.warnings.slice(0, 2).forEach(w => addToast(w.message, 'warning'));
        }

        try {
            addToast('Running workflow...', 'info');
            const res = await fetch('/api/workflows/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nodes: state.nodes,
                    edges: state.edges,
                    triggerData: {
                        message: 'Test message from workflow builder',
                        sender: '1234567890',
                        timestamp: new Date().toISOString(),
                    },
                }),
            });

            const result = await res.json();

            const execResult: ExecutionResult = {
                success: res.ok && result.success !== false,
                executionId: result.executionId || `local_${Date.now()}`,
                duration: result.duration || 0,
                logs: result.logs || [],
                output: result.output,
                error: result.error,
            };

            setLastExecution(execResult);
            setShowExecutionPanel(true);
            setExecutionPanelTab('logs');

            if (execResult.success) {
                addToast(`✓ Workflow completed in ${execResult.duration}ms`, 'success');
            } else {
                addToast(`Workflow failed: ${execResult.error || 'Unknown error'}`, 'error');
            }
        } catch (err) {
            const execResult: ExecutionResult = {
                success: false,
                executionId: `err_${Date.now()}`,
                duration: 0,
                logs: [{ timestamp: new Date().toISOString(), nodeId: 'system', level: 'error', message: String(err) }],
                output: null,
                error: String(err),
            };
            setLastExecution(execResult);
            setShowExecutionPanel(true);
            addToast(`Execution error: ${err}`, 'error');
        } finally {
            setIsExecuting(false);
            actions.setLoading(false);
        }
    }, [state.nodes, state.edges, validationResult, isExecuting, actions, addToast]);

    // ── Export / Import ───────────────────────────────────────────────────────
    const handleExport = useCallback(() => {
        const data = {
            name: workflowName,
            description: 'Exported marketing workflow',
            nodes: state.nodes,
            edges: state.edges,
            exportedAt: new Date().toISOString(),
            version: '1.0.0',
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${workflowName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast('Workflow exported', 'success');
    }, [state.nodes, state.edges, workflowName, addToast]);

    const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (!data.nodes || !Array.isArray(data.nodes)) {
                    addToast('Invalid workflow file — missing nodes', 'error');
                    return;
                }
                actions.loadWorkflow({ nodes: data.nodes, edges: data.edges || [] });
                if (data.name) setWorkflowName(data.name);
                setCurrentWorkflowId(null);
                addToast(`Imported: ${data.name || 'workflow'}`, 'success');
            } catch {
                addToast('Failed to import — invalid JSON file', 'error');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }, [actions, addToast]);

    // ── Undo / Redo ───────────────────────────────────────────────────────────
    const handleUndo = useCallback(() => {
        if (actions.canUndo) { actions.undo(); addToast('Undo', 'info'); }
    }, [actions, addToast]);

    const handleRedo = useCallback(() => {
        if (actions.canRedo) { actions.redo(); addToast('Redo', 'info'); }
    }, [actions, addToast]);

    const logLevelIcon = (level: string) => {
        if (level === 'error') return <XCircle size={12} className="text-red-500 shrink-0" />;
        if (level === 'warning') return <AlertTriangle size={12} className="text-yellow-500 shrink-0" />;
        return <ChevronRight size={12} className="text-blue-400 shrink-0" />;
    };

    return (
        <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-gray-100">

            {/* ── Top Bar ─────────────────────────────────────────────────── */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center shadow-sm z-10 gap-3">

                {/* Left: Name + validation */}
                <div className="flex items-center gap-3 min-w-0">
                    {editingName ? (
                        <input
                            ref={nameInputRef}
                            type="text"
                            value={workflowName}
                            onChange={(e) => setWorkflowName(e.target.value)}
                            onBlur={() => setEditingName(false)}
                            onKeyDown={(e) => { if (e.key === 'Enter') setEditingName(false); }}
                            className="text-lg font-bold text-gray-800 border-b-2 border-blue-500 focus:outline-none bg-transparent min-w-0 w-48"
                            autoFocus
                        />
                    ) : (
                        <button
                            onClick={() => setEditingName(true)}
                            className="text-base font-bold text-gray-800 hover:text-blue-600 transition-colors truncate max-w-[200px]"
                            title="Click to rename"
                        >
                            {workflowName}
                        </button>
                    )}

                    {validationResult && (
                        <div className="flex items-center gap-2 shrink-0">
                            {validationResult.isValid ? (
                                <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                                    <CheckCircle size={13} /> Valid
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                                    <XCircle size={13} /> {validationResult.errors.length} error{validationResult.errors.length !== 1 ? 's' : ''}
                                </span>
                            )}
                            {validationResult.warnings.length > 0 && (
                                <span className="flex items-center gap-1 text-xs text-amber-600">
                                    <AlertTriangle size={12} /> {validationResult.warnings.length}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 shrink-0">

                    {/* New */}
                    <button
                        onClick={handleNew}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                        title="New workflow"
                    >
                        <Plus size={14} />
                        New
                    </button>

                    {/* Library */}
                    <button
                        onClick={handleOpenLibrary}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                        title="Open saved workflows"
                    >
                        <FolderOpen size={14} />
                        Library
                    </button>

                    {/* Undo/Redo */}
                    <div className="flex gap-1">
                        <button onClick={handleUndo} disabled={!actions.canUndo}
                            className="p-1.5 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Undo">
                            <RotateCcw size={14} className="text-gray-600" />
                        </button>
                        <button onClick={handleRedo} disabled={!actions.canRedo}
                            className="p-1.5 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Redo">
                            <RotateCcw size={14} className="text-gray-600 rotate-180" />
                        </button>
                    </div>

                    {/* Import/Export */}
                    <div className="flex gap-1">
                        <label className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium cursor-pointer">
                            <Upload size={14} />
                            Import
                            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                        </label>
                        <button onClick={handleExport}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium">
                            <Download size={14} />
                            Export
                        </button>
                    </div>

                    {/* Save */}
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium disabled:opacity-60"
                    >
                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {currentWorkflowId ? 'Update' : 'Save'}
                    </button>

                    {/* Run */}
                    <button
                        onClick={handleRun}
                        disabled={isExecuting || !validationResult?.isValid}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:shadow-md transition-all text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {isExecuting
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Play size={14} />
                        }
                        {isExecuting ? 'Running...' : 'Run'}
                    </button>
                </div>
            </div>

            {/* ── Status Bar ──────────────────────────────────────────────── */}
            <div className="bg-white border-b border-gray-200 px-4 py-1.5 flex justify-between items-center text-[11px] text-gray-500">
                <div className="flex items-center gap-4">
                    <span>{state.nodes.length} nodes</span>
                    <span>{state.edges.length} connections</span>
                    {state.selectedNode && <span className="text-blue-600">Selected: {state.selectedNode.data?.label}</span>}
                    {currentWorkflowId && <span className="text-green-600">ID: {currentWorkflowId.substring(0, 8)}…</span>}
                </div>
                <div className="flex items-center gap-3">
                    {state.lastSaved && (
                        <span className="flex items-center gap-1">
                            <Clock size={10} /> Saved {state.lastSaved.toLocaleTimeString()}
                        </span>
                    )}
                    {state.isDirty && <span className="text-orange-500 font-medium">● Unsaved changes</span>}
                    {lastExecution && (
                        <button
                            onClick={() => setShowExecutionPanel(!showExecutionPanel)}
                            className="flex items-center gap-1 text-blue-600 hover:underline"
                        >
                            {lastExecution.success
                                ? <CheckCircle size={10} className="text-green-500" />
                                : <XCircle size={10} className="text-red-500" />
                            }
                            Last run: {lastExecution.duration}ms
                            <ChevronDown size={10} className={showExecutionPanel ? 'rotate-180 transition-transform' : 'transition-transform'} />
                        </button>
                    )}
                </div>
            </div>

            {/* ── Main Area ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden flex flex-col relative">

                {/* Canvas */}
                <div className="flex-1 overflow-hidden relative">
                    {state.isLoading && (
                        <div className="absolute inset-0 bg-white/70 z-30 flex items-center justify-center">
                            <LoadingState message={isExecuting ? 'Executing workflow...' : 'Processing...'} />
                        </div>
                    )}
                    <ErrorBoundary>
                        <WorkflowBuilder />
                    </ErrorBoundary>
                </div>

                {/* Execution Results Panel (slide up) */}
                {showExecutionPanel && lastExecution && (
                    <div className="h-64 bg-gray-900 border-t-2 border-gray-700 flex flex-col shrink-0">

                        {/* Panel header */}
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                            <div className="flex items-center gap-3">
                                <span className={`flex items-center gap-1.5 text-sm font-semibold ${lastExecution.success ? 'text-green-400' : 'text-red-400'}`}>
                                    {lastExecution.success
                                        ? <CheckCircle size={14} />
                                        : <XCircle size={14} />
                                    }
                                    {lastExecution.success ? 'Workflow Completed' : 'Workflow Failed'}
                                </span>
                                <span className="text-gray-500 text-xs">{lastExecution.duration}ms · {lastExecution.logs.length} steps</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setExecutionPanelTab('logs')}
                                    className={`text-xs px-2 py-1 rounded ${executionPanelTab === 'logs' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Execution Log
                                </button>
                                <button
                                    onClick={() => setExecutionPanelTab('output')}
                                    className={`text-xs px-2 py-1 rounded ${executionPanelTab === 'output' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Output
                                </button>
                                <button onClick={() => setShowExecutionPanel(false)} className="text-gray-500 hover:text-white ml-2">
                                    <X size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Panel body */}
                        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
                            {executionPanelTab === 'logs' ? (
                                lastExecution.logs.length === 0 ? (
                                    <span className="text-gray-500">No logs generated.</span>
                                ) : (
                                    lastExecution.logs.map((log, i) => (
                                        <div key={i} className="flex items-start gap-2 py-0.5 hover:bg-gray-800 px-1 rounded">
                                            {logLevelIcon(log.level)}
                                            <span className="text-gray-500 shrink-0 text-[10px]">
                                                [{log.nodeId?.substring(0, 8) || 'system'}]
                                            </span>
                                            <span className={
                                                log.level === 'error' ? 'text-red-400' :
                                                    log.level === 'warning' ? 'text-yellow-400' :
                                                        'text-gray-300'
                                            }>
                                                {log.message}
                                            </span>
                                        </div>
                                    ))
                                )
                            ) : (
                                <pre className="text-green-400 whitespace-pre-wrap break-all">
                                    {JSON.stringify(lastExecution.output, null, 2) || 'No output'}
                                </pre>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Workflow Library Drawer ──────────────────────────────────── */}
            {showLibrary && (
                <div className="fixed inset-0 z-50 flex">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setShowLibrary(false)} />
                    <div className="relative ml-auto w-96 bg-white h-full shadow-2xl flex flex-col">
                        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
                            <h2 className="font-bold text-gray-800 flex items-center gap-2">
                                <FolderOpen size={18} className="text-blue-600" />
                                Saved Workflows
                            </h2>
                            <button onClick={() => setShowLibrary(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4">
                            {loadingLibrary ? (
                                <div className="flex items-center justify-center h-32">
                                    <Loader2 size={24} className="animate-spin text-blue-500" />
                                </div>
                            ) : savedWorkflows.length === 0 ? (
                                <div className="text-center text-gray-400 py-12">
                                    <FolderOpen size={40} className="mx-auto mb-3 opacity-30" />
                                    <p className="text-sm">No saved workflows yet.</p>
                                    <p className="text-xs mt-1">Build a workflow and click Save.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {savedWorkflows.map((wf, i) => {
                                        const wfId = wf._id || wf.id || String(i);
                                        return (
                                            <div
                                                key={wfId}
                                                className="bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group"
                                                onClick={() => handleLoadWorkflow(wf)}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <h3 className="font-semibold text-gray-800 text-sm truncate">{wf.name}</h3>
                                                        {wf.description && (
                                                            <p className="text-xs text-gray-500 truncate mt-0.5">{wf.description}</p>
                                                        )}
                                                        <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                                                            <span>{wf.nodes?.length || 0} nodes</span>
                                                            <span>{wf.edges?.length || 0} connections</span>
                                                            {typeof wf.runCount === 'number' && <span>{wf.runCount} runs</span>}
                                                        </div>
                                                        {wf.updatedAt && (
                                                            <p className="text-[10px] text-gray-400 mt-1">
                                                                Updated: {new Date(wf.updatedAt).toLocaleDateString()}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={(e) => handleDeleteWorkflow(wf, e)}
                                                            className="p-1.5 text-red-400 hover:bg-red-50 rounded"
                                                            title="Delete"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleLoadWorkflow(wf); }}
                                                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded"
                                                            title="Load"
                                                        >
                                                            <Copy size={13} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-gray-200 bg-gray-50">
                            <button
                                onClick={() => { setShowLibrary(false); handleNew(); }}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                            >
                                <Plus size={16} />
                                New Workflow
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}

export default function MarketingManager() {
    return (
        <ErrorBoundary>
            <WorkflowProvider>
                <MarketingManagerInner />
            </WorkflowProvider>
        </ErrorBoundary>
    );
}
