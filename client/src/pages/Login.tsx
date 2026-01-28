import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../config';
import { useNavigate } from 'react-router-dom';

export default function Login() {
    const { login, token } = useAuth();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [needsSetup, setNeedsSetup] = useState(false);

    useEffect(() => {
        if (token) navigate('/dashboard');

        // Check if setup is needed
        api.get('/api/auth/setup-check').then(res => {
            if (res.data.needsSetup) setNeedsSetup(true);
        });
    }, [token, navigate]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        try {
            if (needsSetup) {
                await api.post('/api/auth/setup', { username, password });
                // Then login
                const res = await api.post('/api/auth/login', { username, password });
                login(res.data.token);
            } else {
                const res = await api.post('/api/auth/login', { username, password });
                login(res.data.token);
            }
        } catch (err: any) {
            setError(err.response?.data?.message || 'Login failed');
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="px-8 py-6 mt-4 text-left bg-white shadow-lg rounded-xl w-96">
                <h3 className="text-2xl font-bold text-center text-gray-700">
                    {needsSetup ? 'Admin Setup' : 'Admin Login'}
                </h3>
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                <form onSubmit={handleSubmit} className="mt-4">
                    <div className="mt-4">
                        <label className="block text-sm font-light">Username</label>
                        <input
                            type="text"
                            className="w-full px-4 py-2 mt-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-600"
                            value={username} onChange={e => setUsername(e.target.value)} required
                        />
                    </div>
                    <div className="mt-4">
                        <label className="block text-sm font-light">Password</label>
                        <input
                            type="password"
                            className="w-full px-4 py-2 mt-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-600"
                            value={password} onChange={e => setPassword(e.target.value)} required
                        />
                    </div>
                    <div className="mt-6">
                        <button className="w-full px-6 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-900">
                            {needsSetup ? 'Create Admin' : 'Login'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
