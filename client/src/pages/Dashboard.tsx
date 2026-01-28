import { useState, useEffect } from 'react';
import api from '../utils/api';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

export default function Dashboard() {
    const [status, setStatus] = useState<any>({ status: 'disconnected', qr: null });
    const [loading, setLoading] = useState(true);

    const fetchStatus = async () => {
        try {
            const res = await api.get('/whatsapp/status');
            setStatus(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 3000); // Poll every 3s
        return () => clearInterval(interval);
    }, []);

    const handleReconnect = async () => {
        try {
            await api.post('/whatsapp/reconnect');
            alert('Reconnection initiated');
            fetchStatus();
        } catch (err) {
            alert('Error initiating reconnection');
        }
    };

    const getStatusColor = (s: string) => {
        switch (s) {
            case 'connected': return 'text-green-600';
            case 'connecting': return 'text-blue-600';
            case 'reconnecting': return 'text-yellow-600';
            case 'scan_qr': return 'text-orange-600';
            default: return 'text-red-600';
        }
    };

    const getStatusIcon = (s: string) => {
        switch (s) {
            case 'connected': return <CheckCircle className="h-6 w-6 mr-2" />;
            case 'connecting': return <RefreshCw className="h-6 w-6 mr-2 animate-spin" />;
            case 'reconnecting': return <RefreshCw className="h-6 w-6 mr-2 animate-spin" />;
            case 'scan_qr': return <AlertTriangle className="h-6 w-6 mr-2" />;
            default: return <XCircle className="h-6 w-6 mr-2" />;
        }
    };

    if (loading) return <div>Loading status...</div>;

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Internal Status</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Connection Status Card */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h2 className="text-xl font-semibold mb-4">WhatsApp Connection</h2>

                    <div className={`flex items-center text-lg font-medium mb-4 ${getStatusColor(status.status)}`}>
                        {getStatusIcon(status.status)}
                        <span className="capitalize">{status.status.replace('_', ' ')}</span>
                    </div>

                    {status.status === 'scan_qr' && status.qr && (
                        <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border">
                            <QRCodeCanvas value={status.qr} size={256} />
                            <p className="mt-4 text-sm text-gray-500">Scan with WhatsApp</p>
                        </div>
                    )}

                    {status.status === 'disconnected' && (
                        <button
                            onClick={handleReconnect}
                            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                        >
                            Connect Now
                        </button>
                    )}
                </div>

                {/* Quick Stats or Info could go here */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h2 className="text-xl font-semibold mb-4">System Information</h2>
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span className="text-gray-600">Bot Version</span>
                            <span className="font-medium">0.8.0</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">Mode</span>
                            <span className="font-medium bg-green-100 text-green-800 px-2 py-0.5 rounded text-sm">Active</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
