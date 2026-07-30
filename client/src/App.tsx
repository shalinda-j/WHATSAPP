import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import { ShieldOff } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import PwaPrompts from './components/PwaPrompts';
import { PERM, type PermissionKey } from './permissions';

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
const Users = lazy(() => import('./pages/Users'));

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

/**
 * Route-level permission gate. Typing a URL directly must not reach a page
 * the account has no access to — the sidebar hides the link, this stops the
 * deep link, and the API refuses the data. Renders an explanation rather
 * than a redirect so the user understands why, instead of being bounced to
 * the dashboard with no feedback.
 */
const RequirePermission = ({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) => {
  const { can, loading } = useAuth();
  if (loading) return <RouteSpinner />;
  if (can(permission)) return children;
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-6">
      <div className="h-14 w-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
        <ShieldOff className="h-7 w-7 text-amber-600" />
      </div>
      <h2 className="text-lg font-bold text-gray-800">
        You don&apos;t have access to this page
      </h2>
      <p className="text-sm text-gray-500 mt-1 max-w-md">
        Your role doesn&apos;t include the{' '}
        <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">
          {permission}
        </code>{' '}
        permission. Ask an administrator if you need it.
      </p>
      <Link
        to="/dashboard"
        className="mt-5 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700"
      >
        Back to dashboard
      </Link>
    </div>
  );
};

/** Wrap a lazy page in its Suspense boundary + permission gate. */
const Guarded = ({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) => (
  <RequirePermission permission={permission}>
    <Suspense fallback={<RouteSpinner />}>{children}</Suspense>
  </RequirePermission>
);

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

      {/* Fallback only. /kiosk is normally served as its own document
          (client/kiosk.html → src/kiosk-main.tsx) so the terminal can be
          installed as its own fullscreen PWA. This route still catches a
          client-side navigation inside the admin SPA, and covers a server that
          hasn't picked up the new build yet. */}
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
            <Guarded permission={PERM.dashboard}>
              <Dashboard />
            </Guarded>
          }
        />
        <Route
          path="crm"
          element={
            <Guarded permission={PERM.crmView}>
              <CRM />
            </Guarded>
          }
        />
        <Route
          path="chat"
          element={
            <Guarded permission={PERM.chatView}>
              <ChatInterface />
            </Guarded>
          }
        />
        <Route
          path="calendar"
          element={
            <Guarded permission={PERM.calendar}>
              <Calendar />
            </Guarded>
          }
        />
        <Route
          path="follow-up"
          element={
            <Guarded permission={PERM.followup}>
              <FollowUp />
            </Guarded>
          }
        />
        <Route
          path="datasets"
          element={
            <Guarded permission={PERM.datasets}>
              <Datasets />
            </Guarded>
          }
        />
        <Route
          path="webhooks"
          element={
            <Guarded permission={PERM.webhooks}>
              <Webhooks />
            </Guarded>
          }
        />
        <Route
          path="config"
          element={
            <Guarded permission={PERM.config}>
              <Config />
            </Guarded>
          }
        />
        <Route
          path="bulk-message"
          element={
            <Guarded permission={PERM.bulkSend}>
              <BulkSender />
            </Guarded>
          }
        />
        <Route
          path="system"
          element={
            <Guarded permission={PERM.system}>
              <SystemMaintenance />
            </Guarded>
          }
        />
        <Route
          path="voice-agent-hub"
          element={
            <Guarded permission={PERM.voiceView}>
              <VoiceAgentHub />
            </Guarded>
          }
        />
        <Route
          path="sessions"
          element={
            <Guarded permission={PERM.sessionsView}>
              <Sessions />
            </Guarded>
          }
        />
        <Route
          path="form-builder"
          element={
            <Guarded permission={PERM.forms}>
              <FormBuilder />
            </Guarded>
          }
        />
        <Route
          path="agents"
          element={
            <Guarded permission={PERM.agentsView}>
              <AgentsHub />
            </Guarded>
          }
        />
        <Route
          path="agents/approvals"
          element={
            <Guarded permission={PERM.agentsApprove}>
              <ApprovalQueue />
            </Guarded>
          }
        />
        <Route
          path="agents/traces"
          element={
            <Guarded permission={PERM.agentsView}>
              <AgentTraces />
            </Guarded>
          }
        />
        <Route
          path="agents/:name"
          element={
            <Guarded permission={PERM.agentsView}>
              <AgentDetail />
            </Guarded>
          }
        />
        <Route
          path="channels"
          element={
            <Guarded permission={PERM.channels}>
              <Channels />
            </Guarded>
          }
        />
        <Route
          path="campaigns"
          element={
            <Guarded permission={PERM.campaignsView}>
              <Campaigns />
            </Guarded>
          }
        />
        <Route
          path="segments"
          element={
            <Guarded permission={PERM.segments}>
              <Segments />
            </Guarded>
          }
        />
        <Route
          path="marketing-insights"
          element={
            <Guarded permission={PERM.insights}>
              <MarketingInsights />
            </Guarded>
          }
        />
        <Route
          path="content-studio"
          element={
            <Guarded permission={PERM.content}>
              <ContentStudio />
            </Guarded>
          }
        />
        <Route
          path="tenants"
          element={
            <Guarded permission={PERM.tenants}>
              <Tenants />
            </Guarded>
          }
        />
        <Route
          path="audit"
          element={
            <Guarded permission={PERM.audit}>
              <AuditLog />
            </Guarded>
          }
        />
        <Route
          path="consulting-assistant"
          element={
            <Guarded permission={PERM.consulting}>
              <ConsultingAssistant />
            </Guarded>
          }
        />
        <Route
          path="users"
          element={
            <Guarded permission={PERM.usersView}>
              <Users />
            </Guarded>
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
          {/* Install / update chrome. Outside AuthProvider's routes so it shows
              on the login screen too, and it hides itself on /kiosk. */}
          <PwaPrompts />
        </AuthProvider>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
