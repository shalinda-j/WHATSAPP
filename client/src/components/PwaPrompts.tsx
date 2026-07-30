import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, RefreshCw, Share, X } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { applyUpdate, onUpdateReady } from '../lib/registerServiceWorker';

/**
 * The two pieces of PWA chrome the app needs, as one bottom-anchored strip:
 *
 *  - "Update available" — a new build is installed and waiting. We never swap
 *    the worker silently (that can drop a half-typed campaign or cut a voice
 *    session), so the user chooses when to reload.
 *  - "Install app" — offers the native install dialog, or the iOS Share-sheet
 *    steps where no such dialog exists.
 *
 * Deliberately NOT shown on /kiosk: that's a walk-up terminal on a shared
 * tablet, and a floating card over a visitor's voice consultation is noise they
 * can't act on. Kiosk devices are installed once by staff from the admin side.
 */

const INSTALL_DISMISSED_KEY = 'w360.pwaInstallDismissed';
/** Re-offer the install a fortnight after a dismissal, not never and not daily. */
const INSTALL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

function installSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISSED_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < INSTALL_SNOOZE_MS;
  } catch {
    // Private mode / storage disabled — just show the banner.
    return false;
  }
}

function snoozeInstall(): void {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
  } catch {
    /* Nothing to persist to; the banner reappears next load. */
  }
}

export default function PwaPrompts() {
  const { pathname } = useLocation();
  const { canPrompt, needsIosInstructions, promptInstall } = usePwaInstall();

  const [updateReady, setUpdateReady] = useState(false);
  const [applying, setApplying] = useState(false);
  const [installHidden, setInstallHidden] = useState(installSnoozed);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => onUpdateReady(() => setUpdateReady(true)), []);

  const onInstall = useCallback(async () => {
    const accepted = await promptInstall();
    // Accepted or not, the browser won't re-offer this event — hide the card so
    // it doesn't sit there dead.
    if (!accepted) snoozeInstall();
    setInstallHidden(true);
  }, [promptInstall]);

  const onReload = useCallback(() => {
    setApplying(true);
    applyUpdate();
  }, []);

  // The kiosk runs unattended in front of visitors — no app chrome there.
  if (pathname.startsWith('/kiosk')) return null;

  const showInstall = !installHidden && (canPrompt || needsIosInstructions);
  if (!updateReady && !showInstall) return null;

  return (
    <div
      className="fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3"
      style={{
        bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      {updateReady && (
        <div
          role="status"
          className="pointer-events-auto w-full max-w-md rounded-2xl border border-green-500/30 bg-gray-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur flex items-center gap-3"
        >
          <RefreshCw
            className={`h-5 w-5 shrink-0 text-green-400 ${applying ? 'animate-spin' : ''}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">
              A new version is ready
            </p>
            <p className="text-xs text-gray-400 leading-tight mt-0.5">
              Reload to pick up the latest changes.
            </p>
          </div>
          <button
            type="button"
            onClick={onReload}
            disabled={applying}
            style={{ touchAction: 'manipulation' }}
            className="shrink-0 rounded-xl bg-green-600 px-3.5 py-2 text-xs font-bold uppercase tracking-wide hover:bg-green-500 active:bg-green-700 disabled:opacity-60"
          >
            {applying ? 'Reloading…' : 'Reload'}
          </button>
        </div>
      )}

      {showInstall && (
        <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <img
              src="/icon-192.png"
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">
                Install Work 360 AI
              </p>
              <p className="text-xs text-gray-400 leading-tight mt-0.5">
                Full-screen, on your home screen, opens in one tap.
              </p>
            </div>
            {canPrompt ? (
              <button
                type="button"
                onClick={onInstall}
                style={{ touchAction: 'manipulation' }}
                className="shrink-0 rounded-xl bg-green-600 px-3.5 py-2 text-xs font-bold uppercase tracking-wide hover:bg-green-500 active:bg-green-700 flex items-center gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Install
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowIosHelp((v) => !v)}
                style={{ touchAction: 'manipulation' }}
                className="shrink-0 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold uppercase tracking-wide hover:bg-white/20"
              >
                How
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                snoozeInstall();
                setInstallHidden(true);
              }}
              aria-label="Dismiss"
              style={{ touchAction: 'manipulation' }}
              className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-white/10 hover:text-gray-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {showIosHelp && needsIosInstructions && (
            <ol className="mt-3 space-y-1.5 border-t border-gray-700 pt-3 text-xs text-gray-300">
              <li className="flex items-center gap-2">
                <span className="font-bold text-gray-500">1.</span>
                <span className="flex items-center gap-1.5">
                  Tap <Share className="h-3.5 w-3.5 text-blue-400" /> Share in
                  Safari&rsquo;s toolbar
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-bold text-gray-500">2.</span>
                <span>Choose &ldquo;Add to Home Screen&rdquo;</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-bold text-gray-500">3.</span>
                <span>Tap Add — the app appears with your other icons</span>
              </li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
