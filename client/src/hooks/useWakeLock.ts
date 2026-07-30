import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * Screen Wake Lock — keeps a kiosk display awake while a session is running.
 *
 * Without it a tablet dims and locks mid-conversation on its normal idle
 * timeout, which on iOS/Android also suspends the AudioContext and kills the
 * mic stream. The visitor's answer is simply lost.
 *
 * Availability is patchy (Chrome/Edge/Android yes, Safari 16.4+ yes, older
 * iOS no), and the lock is dropped by the OS whenever the tab is hidden — so
 * this hook treats it as strictly best-effort and re-acquires on every return
 * to visibility. A browser without support just behaves as it does today.
 */

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

interface WakeLockNavigator {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

export function useWakeLock(): {
  request: () => void;
  release: () => void;
  supported: boolean;
} {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  // Tracks INTENT, separately from whether we currently hold the lock: the OS
  // releases it on tab-hide, and we need to know whether to take it back.
  const wantedRef = useRef(false);

  const supported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as unknown as WakeLockNavigator).wakeLock?.request ===
      'function';

  const acquire = useCallback(async () => {
    const nav = navigator as unknown as WakeLockNavigator;
    if (!nav.wakeLock?.request) return;
    if (sentinelRef.current && !sentinelRef.current.released) return;
    // A hidden document can't hold a wake lock; the visibility handler will
    // ask again when the tab comes back.
    if (
      typeof document !== 'undefined' &&
      document.visibilityState !== 'visible'
    ) {
      return;
    }
    try {
      const sentinel = await nav.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) sentinelRef.current = null;
      });
    } catch {
      // Denied (low battery, unsupported, not visible) — nothing to do.
    }
  }, []);

  const request = useCallback(() => {
    wantedRef.current = true;
    void acquire();
  }, [acquire]);

  const release = useCallback(() => {
    wantedRef.current = false;
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel && !sentinel.released) {
      sentinel.release().catch(() => {
        /* Already released by the OS — nothing to undo. */
      });
    }
  }, []);

  // Re-acquire when the tab becomes visible again, but only if the caller
  // still wants the lock (i.e. the session is still running).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wantedRef.current) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      // Never leave a lock held after unmount.
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      wantedRef.current = false;
      if (sentinel && !sentinel.released) {
        sentinel.release().catch(() => {
          /* Unmounting anyway; a failed release is not actionable. */
        });
      }
    };
  }, [acquire]);

  // Stable identity so callers can list this in a useCallback dep array
  // without rebuilding those callbacks on every render.
  return useMemo(
    () => ({ request, release, supported }),
    [request, release, supported],
  );
}
