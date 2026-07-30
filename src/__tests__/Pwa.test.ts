import fs from 'fs';
import path from 'path';
import {
  cacheControlFor,
  isNoStoreAsset,
  NO_STORE_CACHE_CONTROL,
} from '../server/utils/staticCache';

/**
 * The PWA is three static files (manifest, service worker, offline page) plus a
 * set of icons, none of which the TypeScript compiler or the React build will
 * ever type-check. A typo in an icon path or a missing `maskable` entry is
 * invisible until someone tries to install the app on a phone — so assert the
 * contract here instead.
 */

const PUBLIC_DIR = path.join(__dirname, '../../client/public');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.webmanifest');
const KIOSK_MANIFEST_PATH = path.join(PUBLIC_DIR, 'kiosk.webmanifest');
const SW_PATH = path.join(PUBLIC_DIR, 'sw.js');
const INDEX_HTML = path.join(__dirname, '../../client/index.html');
const KIOSK_HTML = path.join(__dirname, '../../client/kiosk.html');

interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

interface Manifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
  shortcuts?: { name: string; url: string }[];
}

const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const kioskManifest: Manifest = JSON.parse(
  fs.readFileSync(KIOSK_MANIFEST_PATH, 'utf8'),
);
const swSource = fs.readFileSync(SW_PATH, 'utf8');
const indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');
const kioskHtml = fs.readFileSync(KIOSK_HTML, 'utf8');

/** Read width/height straight out of a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('web app manifest', () => {
  it('declares the fields a browser needs before it will offer an install', () => {
    expect(manifest.name).toBe('Work 360 AI');
    expect(manifest.short_name.length).toBeGreaterThan(0);
    // Chrome caps the launcher label at ~12 characters.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('uses one colour for the status bar and the splash screen', () => {
    // Both must match the app's own gray-900 header, or the status bar bands
    // against it on Android and the splash flashes a different colour.
    expect(manifest.theme_color).toBe('#111827');
    expect(manifest.background_color).toBe('#111827');
  });

  it('ships both 192px and 512px icons for "any" and "maskable"', () => {
    const bySizeAndPurpose = new Map(
      manifest.icons.map((i) => [`${i.sizes}:${i.purpose}`, i]),
    );
    for (const purpose of ['any', 'maskable']) {
      for (const size of ['192x192', '512x512']) {
        expect(bySizeAndPurpose.has(`${size}:${purpose}`)).toBe(true);
      }
    }
  });

  it('points every icon at a real PNG of the declared size', () => {
    for (const icon of manifest.icons) {
      const file = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ''));
      expect(fs.existsSync(file)).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(file)).toEqual({ width: w, height: h });
      expect(icon.type).toBe('image/png');
    }
  });

  it('only shortcuts to routes the SPA actually serves', () => {
    // A shortcut to a dead route installs a home-screen icon that lands the
    // user on the catch-all redirect.
    const routes = ['/chat', '/crm', '/kiosk'];
    for (const shortcut of manifest.shortcuts ?? []) {
      expect(routes).toContain(shortcut.url);
    }
    expect(manifest.shortcuts?.length).toBeGreaterThan(0);
  });

  it('has an apple-touch-icon on disk, since iOS ignores the manifest icons', () => {
    const file = path.join(PUBLIC_DIR, 'apple-touch-icon.png');
    expect(fs.existsSync(file)).toBe(true);
    expect(pngSize(file)).toEqual({ width: 180, height: 180 });
  });
});

describe('index.html PWA wiring', () => {
  it('links the manifest and the apple touch icon', () => {
    expect(indexHtml).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(indexHtml).toContain(
      'rel="apple-touch-icon" href="/apple-touch-icon.png"',
    );
  });

  it('declares a theme-color matching the manifest', () => {
    expect(indexHtml).toContain(
      `<meta name="theme-color" content="${manifest.theme_color}" />`,
    );
  });

  it('keeps viewport-fit=cover, which the safe-area padding depends on', () => {
    expect(indexHtml).toContain('viewport-fit=cover');
  });
});

describe('kiosk app manifest', () => {
  it('is a distinct app identity from the admin panel', () => {
    // Same origin, two installable apps. `id` is what keeps them apart in the
    // launcher — share it and installing one replaces the other.
    expect(kioskManifest.id).toBe('/kiosk');
    expect(manifest.id).toBe('/');
    expect(kioskManifest.id).not.toBe(manifest.id);
    expect(kioskManifest.name).not.toBe(manifest.name);
  });

  it('launches fullscreen and scoped to the terminal', () => {
    // fullscreen, not standalone: a walk-up terminal should show no system
    // chrome at all. Scope keeps a visitor from navigating out of /kiosk into
    // the admin panel inside the installed app.
    expect(kioskManifest.display).toBe('fullscreen');
    expect(kioskManifest.start_url).toBe('/kiosk');
    expect(kioskManifest.scope).toBe('/kiosk');
  });

  it('is themed to the kiosk screen, not the admin header', () => {
    expect(kioskManifest.theme_color).toBe('#022c22');
    expect(kioskManifest.background_color).toBe('#022c22');
    expect(kioskManifest.theme_color).not.toBe(manifest.theme_color);
  });

  it('ships its own icons, visually distinct from the admin set', () => {
    const srcs = kioskManifest.icons.map((i) => i.src);
    for (const icon of kioskManifest.icons) {
      const file = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ''));
      expect(fs.existsSync(file)).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(file)).toEqual({ width: w, height: h });
    }
    // Two apps on one home screen with the same icon are indistinguishable, so
    // the kiosk set must not merely reuse the admin files.
    for (const adminIcon of manifest.icons) {
      expect(srcs).not.toContain(adminIcon.src);
    }
    for (const purpose of ['any', 'maskable']) {
      for (const size of ['192x192', '512x512']) {
        expect(
          kioskManifest.icons.some(
            (i) => i.sizes === size && i.purpose === purpose,
          ),
        ).toBe(true);
      }
    }
  });

  it('has its own apple-touch-icon', () => {
    const file = path.join(PUBLIC_DIR, 'kiosk-apple-touch-icon.png');
    expect(fs.existsSync(file)).toBe(true);
    expect(pngSize(file)).toEqual({ width: 180, height: 180 });
  });

  it('does not advertise shortcuts — the terminal has one screen', () => {
    expect(kioskManifest.shortcuts).toBeUndefined();
  });
});

describe('kiosk.html', () => {
  it('links the kiosk manifest, never the admin one', () => {
    // The whole reason the kiosk is a second document: a manifest link is
    // per-document, so this is what makes it separately installable.
    expect(kioskHtml).toContain('rel="manifest" href="/kiosk.webmanifest"');
    expect(kioskHtml).not.toContain('/manifest.webmanifest');
  });

  it('mounts the kiosk-only entry, not the admin app', () => {
    expect(kioskHtml).toContain('/src/kiosk-main.tsx');
    expect(kioskHtml).not.toContain('/src/main.tsx');
  });

  it('carries the kiosk theme colour and safe-area viewport', () => {
    expect(kioskHtml).toContain(
      `<meta name="theme-color" content="${kioskManifest.theme_color}" />`,
    );
    expect(kioskHtml).toContain('viewport-fit=cover');
  });

  it('shares one copy of the stale-bundle self-heal script', () => {
    // Both documents load public/bundle-check.js rather than inlining ~100 lines
    // of subtle recovery logic twice, which would drift.
    expect(kioskHtml).toContain('src="/bundle-check.js"');
    expect(indexHtml).toContain('src="/bundle-check.js"');
    expect(fs.existsSync(path.join(PUBLIC_DIR, 'bundle-check.js'))).toBe(true);
    // The probe header has to live with the script now, not in the HTML.
    const bundleCheck = fs.readFileSync(
      path.join(PUBLIC_DIR, 'bundle-check.js'),
      'utf8',
    );
    expect(bundleCheck).toContain("'X-Bundle-Check': '1'");
  });
});

describe('service worker', () => {
  it('never caches the API, the socket or uploads', () => {
    // The single most damaging thing a worker here could do is serve a stale
    // lead list — or a cached 401 — from CacheStorage.
    for (const prefix of ["'/api/'", "'/socket.io/'", "'/uploads/'"]) {
      expect(swSource).toContain(prefix);
    }
    expect(swSource).toMatch(/NETWORK_ONLY_PREFIXES/);
  });

  it('bypasses the stale-bundle self-heal probe', () => {
    // bundle-check.js refetches the current path with X-Bundle-Check to compare
    // asset hashes. Answering that from a cache would either hide a deploy or
    // reload-loop the tab, so the worker has to let it through untouched.
    expect(swSource).toContain("request.headers.get('X-Bundle-Check')");
  });

  it('caches the two app shells under separate keys', () => {
    // index.html and kiosk.html are different documents. One shared key would
    // mean a visit to the admin panel overwrites the kiosk's cached shell, and
    // the terminal would boot the admin bundle when it went offline.
    expect(swSource).toContain("const SHELL_KEY = '/index.html'");
    expect(swSource).toContain("const KIOSK_SHELL_KEY = '/kiosk.html'");
    expect(swSource).toContain('isKioskPath');
  });

  it('ignores non-GET and Range requests', () => {
    expect(swSource).toContain("request.method !== 'GET'");
    expect(swSource).toContain("request.headers.has('range')");
  });

  it('waits for the page to ask before replacing itself', () => {
    // Auto-activating a new worker can drop a half-written campaign or cut a
    // live voice session; the UI offers a Reload chip instead.
    expect(swSource).toContain("event.data.type === 'SKIP_WAITING'");
    // Exactly one call, and it is the one the page asks for — not an
    // unconditional skipWaiting() in the install or activate handler.
    const calls = swSource.match(/self\.skipWaiting\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    const installBody = swSource.slice(
      swSource.indexOf("addEventListener('install'"),
      swSource.indexOf("addEventListener('activate'"),
    );
    expect(installBody).not.toContain('skipWaiting');
  });

  it('precaches only fixed-name files, never hashed bundles', () => {
    const match = swSource.match(/const PRECACHE_URLS = \[([^\]]*)\]/);
    expect(match).not.toBeNull();
    expect(match?.[1]).not.toContain('/assets/');
  });

  it('drops caches from previous versions on activate', () => {
    expect(swSource).toContain('EXPECTED_CACHES');
    expect(swSource).toContain('caches.delete');
  });
});

describe('static cache-control policy', () => {
  it('forces no-store on every fixed-name bundle file', () => {
    // These four change content on every deploy without changing URL. sw.js is
    // the critical one: cached immutable, a worker can never be replaced.
    for (const file of [
      'index.html',
      'kiosk.html',
      'sw.js',
      'manifest.webmanifest',
      'kiosk.webmanifest',
      'offline.html',
      'bundle-check.js',
    ]) {
      expect(isNoStoreAsset(`/srv/client/dist/${file}`)).toBe(true);
      expect(cacheControlFor(`/srv/client/dist/${file}`)).toBe(
        NO_STORE_CACHE_CONTROL,
      );
    }
  });

  it('leaves hashed assets on the long immutable max-age', () => {
    expect(isNoStoreAsset('/srv/client/dist/assets/index-a1b2c3d4.js')).toBe(
      false,
    );
    expect(cacheControlFor('/srv/client/dist/assets/index-a1b2c3d4.js')).toBe(
      null,
    );
    expect(cacheControlFor('/srv/client/dist/icon-512.png')).toBe(null);
  });

  it('matches on the basename, not a path substring', () => {
    // A directory called "sw.js" or an asset ending in "index.html" must not
    // drag the whole bundle onto no-store.
    expect(isNoStoreAsset('/srv/sw.js/assets/app-1234.js')).toBe(false);
    expect(isNoStoreAsset('/srv/client/dist/not-index.html')).toBe(false);
  });

  it('covers exactly the files the PWA ships with fixed names', () => {
    for (const file of ['sw.js', 'manifest.webmanifest', 'offline.html']) {
      expect(fs.existsSync(path.join(PUBLIC_DIR, file))).toBe(true);
    }
  });
});
