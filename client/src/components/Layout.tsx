
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Database, Settings, LogOut, MessageSquare, Smartphone } from 'lucide-react';

export default function Layout() {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const isActive = (path: string) => location.pathname === path ? 'bg-gray-700' : '';

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-64 bg-gray-800 text-gray-100 flex flex-col">
                <div className="h-16 flex items-center justify-center font-bold text-xl border-b border-gray-700">
                    <MessageSquare className="mr-2" /> Jayalath Bot
                </div>
                <div className="flex-1 overflow-y-auto py-4">
                    <nav className="px-2 space-y-2">
                        <Link to="/dashboard" className={`flex items-center px-4 py-2 rounded transition-colors hover:bg-gray-700 ${isActive('/dashboard')}`}>
                            <LayoutDashboard className="mr-3 h-5 w-5" /> Dashboard
                        </Link>
                        <Link to="/datasets" className={`flex items-center px-4 py-2 rounded transition-colors hover:bg-gray-700 ${isActive('/datasets')}`}>
                            <Database className="mr-3 h-5 w-5" /> Datasets
                        </Link>
                        <Link to="/sessions" className={`flex items-center px-4 py-2 rounded transition-colors hover:bg-gray-700 ${isActive('/sessions')}`}>
                            <Smartphone className="mr-3 h-5 w-5" /> Linked Devices
                        </Link>
                        <Link to="/config" className={`flex items-center px-4 py-2 rounded transition-colors hover:bg-gray-700 ${isActive('/config')}`}>
                            <Settings className="mr-3 h-5 w-5" /> Configuration
                        </Link>
                    </nav>
                </div>
                <div className="p-4 border-t border-gray-700">
                    <button onClick={handleLogout} className="flex items-center text-gray-400 hover:text-white transition-colors w-full">
                        <LogOut className="mr-3 h-5 w-5" /> Logout
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-8">
                    <Outlet />
                </div>
            </div>
        </div>
    );
}
