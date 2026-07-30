/**
 * Service worker registration + update plumbing.
 *
 * The worker itself lives at `client/public/sw.js` (copied verbatim into the
 * build) — see the long comment at the top of that file for the caching
 * strategy. This module owns the lifecycle around it:
 *
 *  - register once, after `load`, so the worker never competes with the first
 *    paint for bandwidth;
 *  - never activate a new worker behind the user's back. A swap mid-form or
 *    mid-voice-session loses work, so a waiting worker just reports itself and
 *    the UI offers a Reload chip (see `components/PwaPrompts.tsx`);
 *  - unregister in dev, because a cached shell against a Vite dev server is a
 *    guaranteed hour of debugging phantom stale code.
 */

type UpdateListener = () => void;

let waitingWorker: ServiceWorker | null = null;
let reloading = false;
let registration: ServiceWorkerRegistration | null = null;
const updateListeners = new Set<UpdateListener>();

/** Don't hammer the server with update checks on every tab focus. */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
let lastUpdateCheck = 0;

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    // A worker can only be registered from a secure context. localhost counts,
    // which is what keeps `vite preview` usable.
    window.isSecureContext
  );
}

function announceUpdate(worker: ServiceWorker): void {
  waitingWorker = worker;
  updateListeners.forEach((fn) => fn());
}

/**
 * Subscribe to "a new version is installed and waiting". Returns an
 * unsubscribe function; fires immediately if an update is already pending, so a
 * component mounting late still learns about it.
 */
export function onUpdateReady(listener: UpdateListener): () => void {
  updateListeners.add(listener);
  if (waitingWorker) listener();
  return () => updateListeners.delete(listener);
}

export function isUpdateReady(): boolean {
  return waitingWorker !== null;
}

/**
 * Apply a pending update: tell the waiting worker to take over, then reload
 * once it has. The reload is driven by `controllerchange` rather than fired
 * straight after postMessage, so the page comes back under the NEW worker and
 * can't get the old one's cached assets on the way in.
 */
export function applyUpdate(): void {
  const worker = waitingWorker;
  if (!worker) {
    window.location.reload();
    return;
  }
  worker.postMessage({ type: 'SKIP_WAITING' });
  // Safety net: if the worker never activates (rare, but a stuck install
  // shouldn't leave a dead button), reload anyway.
  window.setTimeout(() => {
    if (!reloading) {
      reloading = true;
      window.location.reload();
    }
  }, 4000);
}

function watchRegistration(reg: ServiceWorkerRegistration): void {
  registration = reg;

  // Already waiting when we registered — e.g. the user opened a second tab
  // after the first one installed an update.
  if (reg.waiting && navigator.serviceWorker.controller) {
    announceUpdate(reg.waiting);
  }

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state !== 'installed') return;
      // No existing controller means this is the FIRST install, not an
      // update — there is nothing for the user to reload into.
      if (navigator.serviceWorker.controller) {
        announceUpdate(installing);
      }
    });
  });
}

/**
 * Check for a new deploy when the user comes back to the tab. Long-lived admin
 * tabs are the norm here (someone leaves the dashboard open for days), and
 * without this they'd only see a new build after a manual refresh.
 */
function watchForUpdates(): void {
  const maybeCheck = () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
    lastUpdateCheck = now;
    registration?.update().catch(() => {
      /* Offline or the server is down — try again on the next focus. */
    });
  };
  document.addEventListener('visibilitychange', maybeCheck);
  window.addEventListener('online', maybeCheck);
}

export function registerServiceWorker(): void {
  if (!supported()) return;

  // In dev the Vite server owns module resolution; a worker serving a cached
  // shell would shadow it. Actively tear down anything a previous production
  // visit to the same origin left behind.
  if (import.meta.env.DEV) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => void r.unregister()))
      .catch(() => {
        /* Nothing registered — that's the desired state anyway. */
      });
    return;
  }

  // Whether this page load was ALREADY under a worker. The worker calls
  // clients.claim() on activate, so a brand-new install also fires
  // `controllerchange` — reloading on that would refresh every first-time
  // visitor for no reason. Only a controller *replacing* another one means a
  // new version has taken over.
  const hadController = navigator.serviceWorker.controller !== null;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    // The new worker took over. One reload, guarded, so two rapid
    // controllerchange events can't fight each other.
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  const start = () => {
    lastUpdateCheck = Date.now();
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        watchRegistration(reg);
        watchForUpdates();
      })
      .catch(() => {
        // A failed registration is not fatal — the app runs exactly as it did
        // before it had a worker.
      });
  };

  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start, { once: true });
  }
}
