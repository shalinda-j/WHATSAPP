// Reusable helper to play base64-encoded audio in the browser.
// Mirrors the base64 -> Blob -> object URL -> new Audio().play() pattern
// from client/src/pages/VoiceAgentHub.tsx (testLanguageGreeting, ~lines 368-411),
// promisified so callers can await playback completion before re-arming.

/**
 * A single reusable <audio> element, "unlocked" by a real user gesture.
 *
 * iOS Safari only lets an element play if a user gesture is on the stack, or
 * if THAT element has already been played from one. In the kiosk loop the tap
 * that starts the session is long gone by the time the first reply arrives —
 * so a fresh `new Audio()` per turn is silently blocked and the visitor sees
 * the assistant "speaking" with no sound. Playing a silent buffer through one
 * element during the tap keeps that element playable for the whole session.
 */
let unlockedEl: HTMLAudioElement | null = null;
let unlockedBusy = false;

// 0.05s of silence — the shortest valid WAV that satisfies the gesture rule.
const SILENT_WAV =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/**
 * Call this SYNCHRONOUSLY from a click/tap handler — before any `await` — so
 * the browser still sees the gesture. Safe to call repeatedly; a failure is
 * non-fatal (playback just falls back to per-turn elements).
 */
export function unlockAudioPlayback(): void {
  try {
    if (!unlockedEl) {
      unlockedEl = new Audio();
      unlockedEl.preload = 'auto';
      // Some iOS builds refuse to play a muted element and then keep the
      // element muted for later real playback, so use volume instead.
      unlockedEl.volume = 0;
    }
    unlockedEl.src = `data:audio/wav;base64,${SILENT_WAV}`;
    const p = unlockedEl.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        /* Silent-unlock rejection is expected without a gesture. */
      });
    }
  } catch {
    /* Unlocking is best-effort — never break the tap handler. */
  }
}

/** Drop the unlocked element (session ended / component unmounted). */
export function releaseAudioPlayback(): void {
  try {
    unlockedEl?.pause();
  } catch {
    /* ignore */
  }
  unlockedEl = null;
  unlockedBusy = false;
}

/**
 * Decode a base64 audio payload, play it, and resolve when playback finishes.
 *
 * The returned promise resolves on the audio "ended" event (normal completion)
 * and also resolves quietly if playback is blocked or errors, so a kiosk loop
 * can always advance to the next turn. The object URL is always revoked.
 *
 * Pass an AbortSignal to support barge-in: aborting pauses playback immediately
 * and resolves the promise, so the caller can re-arm the mic and let the visitor
 * talk over the assistant.
 *
 * @param base64 Raw base64 string (no data: URI prefix).
 * @param mime   MIME type for the Blob, e.g. "audio/wav" or "audio/mpeg".
 * @param signal Optional AbortSignal — abort to stop playback (barge-in).
 */
export async function playBase64Audio(
  base64: string,
  mime: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let url: string | null = null;
    let audioEl: HTMLAudioElement | null = null;
    let usedShared = false;
    let settled = false;

    const cleanup = (): void => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (url) {
        URL.revokeObjectURL(url);
        url = null;
      }
      if (usedShared) {
        unlockedBusy = false;
        if (audioEl) {
          audioEl.onended = null;
          audioEl.onerror = null;
        }
      }
    };

    // Every exit path funnels through here: the element fires both `ended`
    // and (on some browsers) `error` for the same playback, and resolving a
    // promise twice would let the kiosk loop re-arm the mic mid-sentence.
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onAbort = (): void => {
      // Barge-in: stop the assistant mid-sentence.
      if (audioEl) {
        try {
          audioEl.pause();
        } catch {
          /* ignore */
        }
      }
      finish();
    };

    try {
      if (!base64) {
        finish();
        return;
      }
      if (signal?.aborted) {
        finish();
        return;
      }

      // Decode base64 -> bytes -> Blob
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime || 'audio/mpeg' });

      url = URL.createObjectURL(blob);

      // Prefer the gesture-unlocked element (iOS), but never reuse it while
      // it's mid-playback — that would cut off the previous turn.
      if (unlockedEl && !unlockedBusy) {
        audioEl = unlockedEl;
        usedShared = true;
        unlockedBusy = true;
        audioEl.volume = 1;
        audioEl.src = url;
      } else {
        audioEl = new Audio(url);
      }

      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      audioEl.onended = finish;
      audioEl.onerror = finish;

      // play() may reject (e.g. autoplay blocked) — resolve quietly either way.
      const playResult = audioEl.play();
      if (playResult && typeof playResult.then === 'function') {
        playResult.catch(() => finish());
      }
    } catch {
      finish();
    }
  });
}
