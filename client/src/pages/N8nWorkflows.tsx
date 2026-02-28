import { useState } from 'react';
import { Share2 } from 'lucide-react';

export default function N8nWorkflows() {
    const [iframeError, setIframeError] = useState(false);
    const n8nUrl = 'http://188.166.178.142:5678';

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col">
            <header className="mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
                        <Share2 className="w-8 h-8 text-indigo-600" />
                        n8n Automations
                    </h1>
                    <p className="text-gray-500 mt-2">
                        Manage your social media pipelines, CRM integrations, and custom logic workflows.
                    </p>
                </div>
            </header>

            <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
                {iframeError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-gray-50">
                        <div className="bg-red-50 text-red-500 p-4 rounded-full mb-4">
                            <Share2 className="w-12 h-12" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800 mb-2">Connection Blocked by Browser</h3>
                        <p className="text-gray-500 max-w-md mb-6">
                            Your browser is blocking the n8n interface from loading inside this dashboard because it uses HTTP (Mixed Content).
                        </p>
                        <a
                            href={n8nUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition shadow-md font-bold"
                        >
                            Open n8n Securely in a New Tab
                        </a>
                    </div>
                ) : (
                    <iframe
                        title="n8n Dashboard"
                        src={n8nUrl}
                        className="w-full h-full border-0"
                        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                        onError={() => setIframeError(true)}
                        onLoad={(e) => {
                            // Basic check to see if iframe is completely blocked
                            try {
                                if (!e.currentTarget.contentWindow) {
                                    setIframeError(true);
                                }
                            } catch (err) {
                                // Ignore CORS errors from the iframe trying to talk to parent
                            }
                        }}
                    />
                )}
            </div>
        </div>
    );
}
