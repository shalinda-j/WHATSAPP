import WorkflowBuilder from '../components/workflow/WorkflowBuilder';
import { Save, Play } from 'lucide-react';

export default function MarketingManager() {
    // In a real implementation, we would fetch saved workflows here
    // and pass them to WorkflowBuilder, or let WorkflowBuilder handle it.

    const handleSave = () => {
        // Todo: Implement save logic via ref or context
        console.log("Save workflow triggered");
        alert("Workflow saved (simulation)");
    };

    const handleRun = () => {
        // Todo: Implement run logic
        console.log("Run workflow triggered");
        alert("Workflow execution started (simulation)");
    };

    return (
        <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Marketing Workflow Builder</h1>
                    <p className="text-gray-500 text-sm">Design your automated marketing strategies</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium border border-gray-300"
                    >
                        <Save size={18} />
                        Save
                    </button>
                    <button
                        onClick={handleRun}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:shadow-lg transition-all transform hover:scale-105 font-medium"
                    >
                        <Play size={18} />
                        Run Workflow
                    </button>
                </div>
            </div>

            {/* Canvas Area */}
            <div className="flex-1 bg-gray-50 p-4 overflow-hidden">
                <WorkflowBuilder />
            </div>
        </div>
    );
}
