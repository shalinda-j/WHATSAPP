import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Datasets from './pages/Datasets';
import Webhooks from './pages/Webhooks';
import Config from './pages/Config';
import SystemMaintenance from './pages/SystemMaintenance';
import BulkSender from './pages/BulkSender';
import MarketingManager from './pages/MarketingManager';
import VoiceAgentHub from './pages/VoiceAgentHub';
import CRM from './pages/CRM';
import ChatInterface from './pages/ChatInterface';
import Sessions from './pages/Sessions';
import FormBuilder from './pages/FormBuilder';
import Calendar from './pages/Calendar';
import FollowUp from './pages/FollowUp';
import AgentsHub from './pages/AgentsHub';
import AgentDetail from './pages/AgentDetail';
import ApprovalQueue from './pages/ApprovalQueue';
import AgentTraces from './pages/AgentTraces';
import Layout from './components/Layout';

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { token, loading } = useAuth();
  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-green-200 border-t-green-600"></div>
      </div>
    );
  if (!token) return <Navigate to="/login" />;
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="crm" element={<CRM />} />
        <Route path="chat" element={<ChatInterface />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="follow-up" element={<FollowUp />} />
        <Route path="datasets" element={<Datasets />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="config" element={<Config />} />
        <Route path="bulk-message" element={<BulkSender />} />
        <Route path="system" element={<SystemMaintenance />} />
        <Route path="marketing" element={<MarketingManager />} />
        <Route path="voice-agent-hub" element={<VoiceAgentHub />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="form-builder" element={<FormBuilder />} />
        <Route path="agents" element={<AgentsHub />} />
        <Route path="agents/approvals" element={<ApprovalQueue />} />
        <Route path="agents/traces" element={<AgentTraces />} />
        <Route path="agents/:name" element={<AgentDetail />} />
        {/* Legacy redirects */}
        <Route path="analytics" element={<Navigate to="/crm" replace />} />
        <Route path="leads" element={<Navigate to="/crm" replace />} />
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
