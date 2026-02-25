import { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Database, Settings, LogOut, Smartphone, Menu, X, Globe, AudioLines, Megaphone, Users, BarChart3, Share2 } from 'lucide-react';

export default function Layout() {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

    const isActive = (path: string) => location.pathname === path ? 'bg-gray-700' : '';

    const NavLink = ({ to, icon: Icon, children }: { to: string, icon: any, children: React.ReactNode }) => (
        <Link
            to={to}
            onClick={() => setIsSidebarOpen(false)}
            className={`flex items-center px-4 py-2 rounded transition-colors hover:bg-gray-700 ${isActive(to)}`}
        >
            <Icon className="mr-3 h-5 w-5" /> {children}
        </Link>
    );

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 w-full bg-gray-800 text-white z-50 px-4 h-16 flex items-center justify-between shadow-md">
                <div className="flex items-center font-bold text-xl">
                    <img src="/360ai.png" alt="Work 360" className="h-10 mr-2" />
                </div>
                <button onClick={toggleSidebar} className="p-2 rounded hover:bg-gray-700">
                    {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                </button>
            </div>

            {/* Sidebar */}
            <div className={`
                fixed md:static inset-y-0 left-0 z-40 w-64 bg-gray-800 text-gray-100 flex flex-col transition-transform duration-300 ease-in-out
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            `}>
                <div className="hidden md:flex h-20 items-center justify-center font-bold text-xl border-b border-gray-700">
                    <img src="/360ai.png" alt="Work 360" className="h-14 mr-2" />
                </div>

                {/* Space for mobile header */}
                <div className="md:hidden h-16"></div>

                <div className="flex-1 overflow-y-auto py-4">
                    <nav className="px-2 space-y-2">
                        <NavLink to="/dashboard" icon={LayoutDashboard}>Dashboard</NavLink>
                        <NavLink to="/analytics" icon={BarChart3}>Analytics</NavLink>
                        <NavLink to="/leads" icon={Users}>Leads & Registrations</NavLink>
                        <NavLink to="/datasets" icon={Database}>Datasets</NavLink>
                        <NavLink to="/webhooks" icon={Globe}>Webhooks</NavLink>
                        <NavLink to="/sessions" icon={Smartphone}>Linked Devices</NavLink>
                        <NavLink to="/voice-config" icon={AudioLines}>Voice Agent</NavLink>
                        <NavLink to="/bulk-message" icon={Megaphone}>Bulk Messaging</NavLink>
                        <NavLink to="/marketing" icon={Megaphone}>Marketing Manager</NavLink>
                        <NavLink to="/n8n" icon={Share2}>n8n Automations</NavLink>
                        <NavLink to="/system" icon={Database}>System Maintenance</NavLink>

                        <NavLink to="/config" icon={Settings}>Configuration</NavLink>
                    </nav>
                </div>
                <div className="p-4 border-t border-gray-700 bg-gray-900">
                    <button onClick={handleLogout} className="flex items-center text-gray-400 hover:text-white transition-colors w-full mb-4">
                        <LogOut className="mr-3 h-5 w-5" /> Logout
                    </button>
                    <div className="text-xs text-gray-500 text-center">
                        <p>&copy; {new Date().getFullYear()} Work 360</p>
                        <p>v0.8.0</p>
                    </div>
                </div>
            </div>

            {/* Overlay for mobile */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                ></div>
            )}

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto w-full pt-16 md:pt-0">
                <div className="p-4 md:p-8">
                    <Outlet />
                </div>
            </div>
        </div>
    );
}
