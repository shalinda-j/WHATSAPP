
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Datasets from './pages/Datasets';
import Webhooks from './pages/Webhooks';
import Config from './pages/Config';
import VoiceConfig from './pages/VoiceConfig';
import SystemMaintenance from './pages/SystemMaintenance';
import BulkSender from './pages/BulkSender';
import MarketingManager from './pages/MarketingManager';
import Leads from './pages/Leads';
import Analytics from './pages/Analytics';

import Sessions from './pages/Sessions';
import Layout from './components/Layout';

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { token, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!token) return <Navigate to="/login" />;
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/dashboard" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="datasets" element={<Datasets />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="config" element={<Config />} />
        <Route path="voice-config" element={<VoiceConfig />} />
        <Route path="bulk-message" element={<BulkSender />} />
        <Route path="system" element={<SystemMaintenance />} />
        <Route path="marketing" element={<MarketingManager />} />
        <Route path="leads" element={<Leads />} />
        <Route path="analytics" element={<Analytics />} />

        <Route path="sessions" element={<Sessions />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
