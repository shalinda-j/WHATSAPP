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
 * @param base64 Raw base64 string (no data: URI prefix).
 * @param mime   MIME type for the Blob, e.g. "audio/wav" or "audio/mpeg".
 */
export async function playBase64Audio(
  base64: string,
  mime: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let url: string | null = null;

    const cleanup = (): void => {
      if (url) {
        URL.revokeObjectURL(url);
        url = null;
      }
    };

    try {
      if (!base64) {
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
      const audioEl = new Audio(url);

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
