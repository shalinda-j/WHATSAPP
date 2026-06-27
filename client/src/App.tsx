import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { AppErrorBoundary } from './components/AppErrorBoundary';

// Login stays eager — it's the entry point and renders before bundles load.
import Login from './pages/Login';

// Every other page is lazy so the initial bundle is just the shell + Login.
// On a cold visit this drops the JS payload from ~1MB to ~300KB and only the
// page the user actually navigates to is fetched after.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Datasets = lazy(() => import('./pages/Datasets'));
const Webhooks = lazy(() => import('./pages/Webhooks'));
const Config = lazy(() => import('./pages/Config'));
const SystemMaintenance = lazy(() => import('./pages/SystemMaintenance'));
const BulkSender = lazy(() => import('./pages/BulkSender'));
const VoiceAgentHub = lazy(() => import('./pages/VoiceAgentHub'));
const CRM = lazy(() => import('./pages/CRM'));
const ChatInterface = lazy(() => import('./pages/ChatInterface'));
const Sessions = lazy(() => import('./pages/Sessions'));
const FormBuilder = lazy(() => import('./pages/FormBuilder'));
const Calendar = lazy(() => import('./pages/Calendar'));
const FollowUp = lazy(() => import('./pages/FollowUp'));
const AgentsHub = lazy(() => import('./pages/AgentsHub'));
const AgentDetail = lazy(() => import('./pages/AgentDetail'));
const ApprovalQueue = lazy(() => import('./pages/ApprovalQueue'));
const AgentTraces = lazy(() => import('./pages/AgentTraces'));
const Channels = lazy(() => import('./pages/Channels'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const Segments = lazy(() => import('./pages/Segments'));
const Tenants = lazy(() => import('./pages/Tenants'));
const MarketingInsights = lazy(() => import('./pages/MarketingInsights'));
const ContentStudio = lazy(() => import('./pages/ContentStudio'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Kiosk = lazy(() => import('./pages/Kiosk'));
const ConsultingAssistant = lazy(() => import('./pages/ConsultingAssistant'));

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

function RouteSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-4 border-green-200 border-t-green-600"></div>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/kiosk"
        element={
          <Suspense fallback={<RouteSpinner />}>
            <Kiosk />
          </Suspense>
        }
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" />} />
        <Route
          path="dashboard"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route
          path="crm"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <CRM />
            </Suspense>
          }
        />
        <Route
          path="chat"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <ChatInterface />
            </Suspense>
          }
        />
        <Route
          path="calendar"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Calendar />
            </Suspense>
          }
        />
        <Route
          path="follow-up"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <FollowUp />
            </Suspense>
          }
        />
        <Route
          path="datasets"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Datasets />
            </Suspense>
          }
        />
        <Route
          path="webhooks"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Webhooks />
            </Suspense>
          }
        />
        <Route
          path="config"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Config />
            </Suspense>
          }
        />
        <Route
          path="bulk-message"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <BulkSender />
            </Suspense>
          }
        />
        <Route
          path="system"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <SystemMaintenance />
            </Suspense>
          }
        />
        <Route
          path="voice-agent-hub"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <VoiceAgentHub />
            </Suspense>
          }
        />
        <Route
          path="sessions"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Sessions />
            </Suspense>
          }
        />
        <Route
          path="form-builder"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <FormBuilder />
            </Suspense>
          }
        />
        <Route
          path="agents"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <AgentsHub />
            </Suspense>
          }
        />
        <Route
          path="agents/approvals"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <ApprovalQueue />
            </Suspense>
          }
        />
        <Route
          path="agents/traces"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <AgentTraces />
            </Suspense>
          }
        />
        <Route
          path="agents/:name"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <AgentDetail />
            </Suspense>
          }
        />
        <Route
          path="channels"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Channels />
            </Suspense>
          }
        />
        <Route
          path="campaigns"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Campaigns />
            </Suspense>
          }
        />
        <Route
          path="segments"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Segments />
            </Suspense>
          }
        />
        <Route
          path="marketing-insights"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <MarketingInsights />
            </Suspense>
          }
        />
        <Route
          path="content-studio"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <ContentStudio />
            </Suspense>
          }
        />
        <Route
          path="tenants"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <Tenants />
            </Suspense>
          }
        />
        <Route
          path="audit"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <AuditLog />
            </Suspense>
          }
        />
        <Route
          path="consulting-assistant"
          element={
            <Suspense fallback={<RouteSpinner />}>
              <ConsultingAssistant />
            </Suspense>
          }
        />
        {/* Legacy redirects */}
        <Route path="analytics" element={<Navigate to="/crm" replace />} />
        <Route path="leads" element={<Navigate to="/crm" replace />} />
      </Route>

      {/* Catch-all: an unknown path must NEVER render a blank white screen.
          Redirect to "/" (which resolves to the dashboard when signed in, or
          the login page otherwise) instead of matching nothing. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      {/* App-wide error boundary so a render crash on ANY page (including the
          public /kiosk) shows a recovery screen instead of a blank white page. */}
      <AppErrorBoundary>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
