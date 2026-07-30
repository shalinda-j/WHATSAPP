import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Kiosk from './pages/Kiosk';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { registerServiceWorker } from './lib/registerServiceWorker';

/**
 * Entry point for kiosk.html — the walk-up branch terminal.
 *
 * Separate from main.tsx on purpose — see the comment block in kiosk.html for
 * the full reasoning. The part that matters here: no AuthProvider. The old
 * in-SPA /kiosk route rendered inside it, so a public walk-up terminal ran the
 * admin auth check on every load and sat behind an axios interceptor built for
 * signed-in staff.
 *
 * Kiosk is imported eagerly rather than lazily — it IS the page, so a Suspense
 * boundary would only add a spinner (and a round-trip) between the shell and the
 * thing the visitor came for.
 */

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Same app-wide boundary as the admin entry: a render crash on a public
        terminal must show a recovery screen, not a blank white panel that
        nobody in the branch can debug. */}
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Kiosk reads ?preview=1 via useSearchParams, so it needs a router
              even though there is only one screen. */}
          <Route path="/kiosk" element={<Kiosk />} />
          {/* The manifest scopes the installed app to /kiosk, but a stale
              home-screen shortcut or a hand-typed URL can still land somewhere
              else inside this document. Send it to the code screen rather than
              rendering nothing. */}
          <Route path="*" element={<Navigate to="/kiosk" replace />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);

// Same worker as the admin app — one scope, one registration — so the terminal
// keeps working through the branch's flaky wifi. No-ops in dev.
registerServiceWorker();
