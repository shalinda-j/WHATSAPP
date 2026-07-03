// Reusable helper to play base64-encoded audio in the browser.
// Mirrors the base64 -> Blob -> object URL -> new Audio().play() pattern
// from client/src/pages/VoiceAgentHub.tsx (testLanguageGreeting, ~lines 368-411),
// promisified so callers can await playback completion before re-arming.

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

    const cleanup = (): void => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (url) {
        URL.revokeObjectURL(url);
        url = null;
      }
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
      cleanup();
      resolve();
    };

    try {
      if (!base64) {
        resolve();
        return;
      }
      if (signal?.aborted) {
        resolve();
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
      audioEl = new Audio(url);

      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      audioEl.onended = (): void => {
        cleanup();
        resolve();
      };

      audioEl.onerror = (): void => {
        cleanup();
        resolve();
      };

      // play() may reject (e.g. autoplay blocked) — resolve quietly either way.
      const playResult = audioEl.play();
      if (playResult && typeof playResult.then === 'function') {
        playResult.catch(() => {
          cleanup();
          resolve();
        });
      }
    } catch {
      cleanup();
      resolve();
    }
  });
}
