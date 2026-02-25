import { useState, type ChangeEvent } from 'react';
import { Upload, Send, Trash2, FileText, CheckCircle, AlertCircle, Info, Loader } from 'lucide-react';
import { api } from '../config';

interface StatusMessage {
    type: 'success' | 'error' | 'info';
    msg: string;
}

const BulkSender = () => {
    const [message, setMessage] = useState('');
    const [recipients, setRecipients] = useState<string[]>([]);
    const [manualNumbers, setManualNumbers] = useState('');
    const [delay, setDelay] = useState(5);
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<StatusMessage | null>(null);

    const handleCSVUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            const formData = new FormData();
            formData.append('file', file);

            try {
                setLoading(true);
                setStatus({ type: 'info', msg: 'Parsing CSV...' });
                const res = await api.post('/api/bulk/upload-csv', formData);
                setRecipients((prev) => [...new Set([...prev, ...res.data.numbers])]);
                setStatus({ type: 'success', msg: `Imported ${res.data.count} numbers` });
            } catch (err) {
                setStatus({ type: 'error', msg: 'Failed to upload CSV' });
            } finally {
                setLoading(false);
            }
        }
    };

    const handleAddManualNumbers = () => {
        if (!manualNumbers.trim()) return;
        const nums = manualNumbers
            .split(/[\n,]+/)
            .map((s) => s.trim().replace(/\D/g, ''))
            .filter((s) => s.length >= 10);

        setRecipients((prev) => [...new Set([...prev, ...nums])]);
        setManualNumbers('');
    };

    const handleSend = async () => {
        if (recipients.length === 0) {
            setStatus({ type: 'error', msg: 'No recipients added' });
            return;
        }
        if (!message && !mediaFile) {
            setStatus({ type: 'error', msg: 'Please add a message or media' });
            return;
        }

        setLoading(true);
        setStatus({ type: 'info', msg: 'Sending bulk messages... This may take a while.' });

        const formData = new FormData();
        formData.append('recipients', JSON.stringify(recipients));
        formData.append('message', message);
        formData.append('delay', delay.toString());
        if (mediaFile) {
            formData.append('media', mediaFile);
        }

        try {
            const res = await api.post('/api/bulk/send', formData);
            const { success, failed, errors } = res.data;

            const successMsg = `Completed! ✅ ${success} sent, ❌ ${failed} failed.`;
            setStatus({
                type: failed === 0 ? 'success' : 'info',
                msg: successMsg
            });

            if (failed > 0) {
                console.error('Failed numbers:', errors);
            }
        } catch (err: any) {
            setStatus({ type: 'error', msg: err.response?.data?.error || 'Failed to send messages' });
        } finally {
            setLoading(false);
        }
    };

    const clearRecipients = () => setRecipients([]);

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Bulk Message Sender</h1>
                <p className="mt-2 text-gray-600">Send broadcast messages to multiple recipients with built-in delay controls.</p>
            </div>

            {status && (
                <div className={`mb-6 p-4 rounded-md flex items-center ${status.type === 'success' ? 'bg-green-50 text-green-700' :
                    status.type === 'error' ? 'bg-red-50 text-red-700' :
                        'bg-blue-50 text-blue-700'
                    }`}>
                    {status.type === 'success' && <CheckCircle className="mr-2 h-5 w-5" />}
                    {status.type === 'error' && <AlertCircle className="mr-2 h-5 w-5" />}
                    {status.type === 'info' && <Info className="mr-2 h-5 w-5" />}
                    {status.msg}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Message & Config */}
                <div className="space-y-6">
                    <div className="bg-white shadow rounded-lg p-6">
                        <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                            <FileText className="mr-2 h-5 w-5 text-indigo-500" /> Message Content
                        </h2>

                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Message Template</label>
                            <textarea
                                rows={6}
                                className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border"
                                placeholder="Type your message here..."
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                            />
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Media Attachment (Optional)</label>
                            <div className="flex items-center space-x-2">
                                <label className="cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                                    <Upload className="mr-2 h-5 w-5 text-gray-500" />
                                    {mediaFile ? 'Change File' : 'Upload Image / PDF'}
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*,application/pdf,video/*,audio/*"
                                        onChange={(e) => setMediaFile(e.target.files ? e.target.files[0] : null)}
                                    />
                                </label>
                                {mediaFile && (
                                    <div className="flex items-center text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-full">
                                        <span className="truncate max-w-xs">{mediaFile.name}</span>
                                        <button
                                            onClick={() => setMediaFile(null)}
                                            className="ml-2 text-red-500 hover:text-red-700"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="border-t pt-4 mt-6">
                            <h3 className="text-md font-medium text-gray-900 mb-3">Settings</h3>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Delay between messages (seconds)</label>
                                <input
                                    type="number"
                                    min="1"
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border"
                                    value={delay}
                                    onChange={(e) => setDelay(Number(e.target.value))}
                                />
                                <p className="mt-1 text-sm text-gray-500">Recommended: 5-10 seconds to avoid bans.</p>
                            </div>
                        </div>

                        {/* Preview Section */}
                        <div className="border-t pt-4 mt-6">
                            <h3 className="text-md font-medium text-gray-900 mb-3">Message Preview</h3>
                            <div className="bg-[#E5DDD5] p-4 rounded-lg shadow-inner min-h-[150px] flex flex-col items-start space-y-2 relative">
                                {/* WhatsApp Message Bubble */}
                                <div className="bg-white p-2 rounded-lg shadow-sm max-w-[90%] relative rounded-tl-none">

                                    {/* Media Preview */}
                                    {mediaFile && (
                                        <div className="mb-2 rounded-md overflow-hidden bg-gray-100 flex justify-center items-center">
                                            {mediaFile.type.startsWith('image/') ? (
                                                <img
                                                    src={URL.createObjectURL(mediaFile)}
                                                    alt="Preview"
                                                    className="max-w-full max-h-48 object-cover"
                                                />
                                            ) : (
                                                <div className="p-4 flex items-center text-gray-500">
                                                    <FileText className="mr-2" /> {mediaFile.name}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Text Content */}
                                    <p className="text-gray-800 text-sm whitespace-pre-wrap font-sans">
                                        {message || <span className="text-gray-400 italic">Your message will appear here...</span>}
                                    </p>

                                    {/* Timestamp Mock */}
                                    <div className="text-[10px] text-gray-500 text-right mt-1">
                                        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Recipients */}
                <div className="space-y-6">
                    <div className="bg-white shadow rounded-lg p-6 h-full flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-medium text-gray-900">
                                Recipients <span className="ml-2 bg-indigo-100 text-indigo-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">{recipients.length}</span>
                            </h2>
                            {recipients.length > 0 && (
                                <button
                                    onClick={clearRecipients}
                                    className="text-red-600 hover:text-red-800 text-sm flex items-center"
                                >
                                    <Trash2 className="mr-1 h-4 w-4" /> Clear All
                                </button>
                            )}
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 mb-4">
                            <label className="flex-1 cursor-pointer inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                                <Upload className="mr-2 h-5 w-5 text-gray-500" />
                                Import CSV/Excel
                                <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleCSVUpload} />
                            </label>
                            {/* Export could be added here */}
                        </div>

                        <div className="flex gap-2 mb-4">
                            <input
                                type="text"
                                className="flex-1 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border"
                                placeholder="Enter numbers (comma separated)"
                                value={manualNumbers}
                                onChange={(e) => setManualNumbers(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddManualNumbers()}
                            />
                            <button
                                onClick={handleAddManualNumbers}
                                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200"
                            >
                                Add
                            </button>
                        </div>

                        <div className="border rounded-md flex-1 overflow-hidden flex flex-col min-h-[300px]">
                            <div className="overflow-y-auto flex-1 p-0">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone Number</th>
                                            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {recipients.map((num, idx) => (
                                            <tr key={idx}>
                                                <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">{idx + 1}</td>
                                                <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900">{num}</td>
                                                <td className="px-6 py-2 whitespace-nowrap text-right text-sm font-medium">
                                                    <button
                                                        onClick={() => setRecipients(recipients.filter((_, i) => i !== idx))}
                                                        className="text-red-600 hover:text-red-900"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {recipients.length === 0 && (
                                            <tr>
                                                <td colSpan={3} className="px-6 py-10 text-center text-sm text-gray-500">
                                                    No recipients added yet. Import a CSV or add manually.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Action Bar */}
            <div className="mt-8 border-t pt-6 flex justify-end">
                <button
                    onClick={handleSend}
                    disabled={loading || recipients.length === 0}
                    className={`
              inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white 
              ${loading || recipients.length === 0 ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'}
            `}
                >
                    {loading ? (
                        <>
                            <Loader className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
                            Sending...
                        </>
                    ) : (
                        <>
                            <Send className="-ml-1 mr-3 h-5 w-5" />
                            Send Bulk Broadcast
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default BulkSender;
