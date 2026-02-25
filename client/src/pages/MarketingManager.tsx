import { useState, useEffect, useCallback } from 'react';
import WorkflowBuilder from '../components/workflow/WorkflowBuilder';
import { Save, Play, Download, Upload, RotateCcw, History } from 'lucide-react';
import { WorkflowProvider, useWorkflow } from '../components/workflow/WorkflowContext';
import { workflowPersistence } from '../services/workflowPersistence';
import { workflowExecution } from '../services/workflowExecution';
import { workflowValidation } from '../services/workflowValidation';
import ErrorBoundary from '../components/workflow/ErrorBoundary';
import LoadingState from '../components/workflow/LoadingState';
import { ToastContainer } from '../components/workflow/Toast';

export default function MarketingManager() {
    const { state, actions } = useWorkflow();
    const [isExecuting, setIsExecuting] = useState(false);
    const [toasts, setToasts] = useState<Array<{ id: string; message: string; type?: 'success' | 'error' | 'warning' | 'info' }>>([]);
    const [validationResult, setValidationResult] = useState<any>(null);

    // Auto-save functionality
    useEffect(() => {
        if (state.isDirty && !state.isLoading) {
            const autoSaveTimer = setTimeout(() => {
                handleAutoSave();
            }, 2000); // Auto-save after 2 seconds of inactivity

            return () => clearTimeout(autoSaveTimer);
        }
    }, [state.isDirty, state.isLoading, state.nodes, state.edges]);

    // Load auto-saved workflow on mount
    useEffect(() => {
        const autoSave = workflowPersistence.getAutoSave();
        if (autoSave) {
            actions.setNodes(autoSave.nodes);
            actions.setEdges(autoSave.edges);
            addToast('Auto-saved workflow restored', 'info');
        }
    }, []);

    // Validate workflow when nodes/edges change
    useEffect(() => {
        const validation = workflowValidation.validateWorkflow(state.nodes, state.edges);
        setValidationResult(validation);
    }, [state.nodes, state.edges]);

    const addToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
        const id = Date.now().toString();
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    const handleAutoSave = useCallback(async () => {
        try {
            await workflowPersistence.autoSave({
                nodes: state.nodes,
                edges: state.edges,
                name: 'Auto-save'
            });
            console.log('Workflow auto-saved');
        } catch (error) {
            console.error('Auto-save failed:', error);
        }
    }, [state.nodes, state.edges]);

    const handleSave = useCallback(async () => {
        try {
            actions.setLoading(true);
            
            // Validate before saving
            const validation = workflowValidation.validateWorkflow(state.nodes, state.edges);
            if (!validation.isValid) {
                addToast('Cannot save: Workflow has validation errors', 'error');
                validation.errors.forEach(error => {
                    addToast(error.message, 'error');
                });
                return;
            }

            const workflowData = await workflowPersistence.saveToLocalStorage({
                name: `Marketing Workflow ${new Date().toLocaleDateString()}`,
                description: 'Automated marketing workflow',
                nodes: state.nodes,
                edges: state.edges
            });

            actions.setLastSaved(new Date());
            addToast('Workflow saved successfully!', 'success');
            
        } catch (error) {
            console.error('Save failed:', error);
            addToast('Failed to save workflow', 'error');
        } finally {
            actions.setLoading(false);
        }
    }, [state.nodes, state.edges, actions, addToast]);

    const handleRun = useCallback(async () => {
        try {
            setIsExecuting(true);
            actions.setLoading(true);

            // Validate before execution
            const validation = workflowValidation.validateWorkflow(state.nodes, state.edges);
            if (!validation.isValid) {
                addToast('Cannot execute: Workflow has validation errors', 'error');
                validation.errors.forEach(error => {
                    addToast(error.message, 'error');
                });
                return;
            }

            // Show warnings if any
            if (validation.warnings.length > 0) {
                validation.warnings.forEach(warning => {
                    addToast(warning.message, 'warning');
                });
            }

            // Execute workflow
            const result = await workflowExecution.executeWorkflow(state.nodes, state.edges);
            
            if (result.success) {
                addToast(`Workflow executed successfully in ${result.duration}ms!`, 'success');
                console.log('Execution result:', result);
            } else {
                addToast(`Workflow execution failed: ${result.error}`, 'error');
                console.error('Execution error:', result);
            }

        } catch (error) {
            console.error('Execution failed:', error);
            addToast('Workflow execution failed', 'error');
        } finally {
            setIsExecuting(false);
            actions.setLoading(false);
        }
    }, [state.nodes, state.edges, actions, addToast]);

    const handleExport = useCallback(async () => {
        try {
            const workflowData = {
                name: `Marketing Workflow ${new Date().toLocaleDateString()}`,
                description: 'Exported marketing workflow',
                nodes: state.nodes,
                edges: state.edges
            };

            const jsonString = await workflowPersistence.exportWorkflow(workflowData);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `workflow-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            addToast('Workflow exported successfully', 'success');
        } catch (error) {
            console.error('Export failed:', error);
            addToast('Failed to export workflow', 'error');
        }
    }, [state.nodes, state.edges, addToast]);

    const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const jsonString = e.target?.result as string;
                const workflowData = await workflowPersistence.importWorkflow(jsonString);
                
                actions.setNodes(workflowData.nodes);
                actions.setEdges(workflowData.edges);
                addToast('Workflow imported successfully', 'success');
            } catch (error) {
                console.error('Import failed:', error);
                addToast('Failed to import workflow', 'error');
            }
        };
        reader.readAsText(file);
    }, [actions, addToast]);

    const handleUndo = useCallback(() => {
        if (actions.canUndo) {
            actions.undo();
            addToast('Undo successful', 'info');
        }
    }, [actions, addToast]);

    const handleRedo = useCallback(() => {
        if (actions.canRedo) {
            actions.redo();
            addToast('Redo successful', 'info');
        }
    }, [actions, addToast]);

    const clearAutoSave = useCallback(() => {
        workflowPersistence.clearAutoSave();
        addToast('Auto-save cleared', 'info');
    }, [addToast]);

    return (
        <ErrorBoundary>
            <WorkflowProvider>
                <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
                    {/* Header */}
                    <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
                        <div className="flex items-center gap-4">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-800">Marketing Workflow Builder</h1>
                                <p className="text-gray-500 text-sm">Design your automated marketing strategies</p>
                            </div>
                            
                            {/* Validation Status */}
                            {validationResult && (
                                <div className="flex items-center gap-2">
                                    <span className={`text-sm font-medium ${
                                        validationResult.isValid ? 'text-green-600' : 'text-red-600'
                                    }`}>
                                        {validationResult.isValid ? '✓ Valid' : `✗ ${validationResult.errors.length} Errors`}
                                    </span>
                                    {validationResult.warnings.length > 0 && (
                                        <span className="text-sm text-yellow-600">
                                            ⚠ {validationResult.warnings.length} Warnings
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3">
                            {/* Undo/Redo */}
                            <div className="flex gap-1">
                                <button
                                    onClick={handleUndo}
                                    disabled={!actions.canUndo}
                                    className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Undo"
                                >
                                    <RotateCcw size={16} />
                                </button>
                                <button
                                    onClick={handleRedo}
                                    disabled={!actions.canRedo}
                                    className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Redo"
                                >
                                    <RotateCcw size={16} className="rotate-180" />
                                </button>
                            </div>

                            {/* Import/Export */}
                            <div className="flex gap-1">
                                <label className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium border border-gray-300 cursor-pointer">
                                    <Upload size={16} />
                                    Import
                                    <input
                                        type="file"
                                        accept=".json"
                                        onChange={handleImport}
                                        className="hidden"
                                    />
                                </label>
                                <button
                                    onClick={handleExport}
                                    className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium border border-gray-300"
                                >
                                    <Download size={16} />
                                    Export
                                </button>
                            </div>

                            {/* Save */}
                            <button
                                onClick={handleSave}
                                disabled={state.isLoading || !validationResult?.isValid}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={18} />
                                {state.isLoading ? 'Saving...' : 'Save'}
                            </button>

                            {/* Run */}
                            <button
                                onClick={handleRun}
                                disabled={state.isLoading || isExecuting || !validationResult?.isValid}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:shadow-lg transition-all transform hover:scale-105 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Play size={18} />
                                {isExecuting ? 'Running...' : 'Run Workflow'}
                            </button>
                        </div>
                    </div>

                    {/* Status Bar */}
                    <div className="bg-gray-50 border-b border-gray-200 px-6 py-2 flex justify-between items-center text-xs text-gray-600">
                        <div className="flex items-center gap-4">
                            <span>Nodes: {state.nodes.length}</span>
                            <span>Edges: {state.edges.length}</span>
                            <span>Selected: {state.selectedNode?.id || 'None'}</span>
                        </div>
                        <div className="flex items-center gap-4">
                            {state.lastSaved && (
                                <span>Last saved: {state.lastSaved.toLocaleTimeString()}</span>
                            )}
                            {state.isDirty && (
                                <span className="text-orange-600 font-medium">● Unsaved changes</span>
                            )}
                        </div>
                    </div>

                    {/* Canvas Area */}
                    <div className="flex-1 bg-gray-50 overflow-hidden relative">
                        {state.isLoading && (
                            <div className="absolute inset-0 bg-white bg-opacity-75 z-20 flex items-center justify-center">
                                <LoadingState message="Processing workflow..." />
                            </div>
                        )}
                        
                        <ErrorBoundary>
                            <WorkflowBuilder />
                        </ErrorBoundary>
                    </div>

                    {/* Toast Container */}
                    <ToastContainer toasts={toasts} onRemove={removeToast} />
                </div>
            </WorkflowProvider>
        </ErrorBoundary>
    );
}
