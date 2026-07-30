import { useCallback, useEffect, useState } from 'react';

/**
 * "Add to Home Screen" support.
 *
 * Chromium fires a `beforeinstallprompt` event once it decides the app is
 * installable, and the only way to show the native install dialog later is to
 * have called `preventDefault()` on that event and kept the reference. The event
 * fires early — often before React has mounted — so a module-level listener
 * grabs it and any hook mounting afterwards reads the stashed value.
 *
 * iOS Safari has no such event: it can install, but only through the Share
 * sheet. We report that case separately so the UI can explain the manual steps
 * instead of showing a button that cannot work.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Without preventDefault() Chromium shows (and then discards) its own
    // mini-infobar, and the event can't be replayed.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

/** True when the app is already running as an installed app, not a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches === true ||
    // Non-standard, but it is the only signal on older iOS.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  // Chrome/Firefox/Edge on iOS can't install at all, so don't coach the user
  // through steps their browser doesn't have.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function usePwaInstall(): {
  /** A native install dialog is available right now. */
  canPrompt: boolean;
  /** Installable, but only via the iOS Share sheet — show instructions. */
  needsIosInstructions: boolean;
  /** Already installed and running standalone. */
  installed: boolean;
  /** Show the native dialog; resolves true if the user accepted. */
  promptInstall: () => Promise<boolean>;
} {
  const [canPrompt, setCanPrompt] = useState(deferredPrompt !== null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const sync = () => {
      setCanPrompt(deferredPrompt !== null);
      setInstalled(isStandalone());
    };
    listeners.add(sync);
    sync();

    // Launching the installed app from the home screen re-renders in standalone
    // mode without a reload on some platforms, so track the media query too.
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onModeChange = () => setInstalled(isStandalone());
    mq?.addEventListener?.('change', onModeChange);

    return () => {
      listeners.delete(sync);
      mq?.removeEventListener?.('change', onModeChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const evt = deferredPrompt;
    if (!evt) return false;
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      // The event is single-use whichever way it went.
      deferredPrompt = null;
      notify();
      return outcome === 'accepted';
    } catch {
      deferredPrompt = null;
      notify();
      return false;
    }
  }, []);

  return {
    canPrompt,
    needsIosInstructions: !installed && !canPrompt && isIosSafari(),
    installed,
    promptInstall,
  };
}
