import path from 'path';

/**
 * Cache-Control policy for files served out of `client/dist`.
 *
 * Everything Vite emits under `/assets/` carries a content hash, so it is
 * immutable and can be cached for a year. A handful of files at the root of the
 * bundle are the opposite: their NAMES are fixed and their CONTENTS change every
 * deploy, so caching them long-term is how an app gets permanently stuck on an
 * old build.
 *
 * `sw.js` is the dangerous one. A service worker cached `immutable` for a year
 * can never be replaced — the browser's update check re-reads the same script
 * URL, gets the byte-identical cached copy, and concludes there is nothing new.
 * The app would keep serving the old worker (and the old cached shell) until the
 * user manually cleared site data.
 */
export const NO_STORE_FILENAMES = [
  'index.html',
  // The kiosk's own document + manifest. Same reasoning as index.html: fixed
  // name, contents change every deploy.
  'kiosk.html',
  'kiosk.webmanifest',
  'sw.js',
  'manifest.webmanifest',
  'offline.html',
  // Loaded by both HTML entries to detect a stale bundle. If this one is cached
  // immutably it can never be corrected — and it is the thing that recovers
  // browsers stuck on an old build.
  'bundle-check.js',
];

export const NO_STORE_CACHE_CONTROL = 'no-store, must-revalidate';

/** True when this bundle file must never be cached by name. */
export function isNoStoreAsset(filePath: string): boolean {
  return NO_STORE_FILENAMES.includes(path.basename(filePath));
}

/**
 * The Cache-Control value for a built client file, or `null` to leave whatever
 * `express.static` already decided (the long immutable max-age).
 */
export function cacheControlFor(filePath: string): string | null {
  return isNoStoreAsset(filePath) ? NO_STORE_CACHE_CONTROL : null;
}
