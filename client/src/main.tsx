import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { registerServiceWorker } from './lib/registerServiceWorker.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);

// After render, never before: the worker installs in the background and must
// not compete with the first paint. No-ops in dev (and actively unregisters any
// worker a previous production visit left on the same origin).
registerServiceWorker();
