import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';

/** 本番の index.html にだけ CSP の meta を入れる（§8）。開発サーバーは Vite の注入スクリプトがあるため対象外。 */
export const CSP =
  "default-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'";

export function cspPlugin(): Plugin {
  return {
    name: 'reading-notes-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      },
    },
  };
}

/** ビルド成果物の一覧から版つきの Service Worker を生成する（§8）。 */
export function serviceWorkerPlugin(): Plugin {
  return {
    name: 'reading-notes-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const assets = ['./', ...files.map((f) => `./${f}`), './theme-init.js', './manifest.webmanifest', './icon.svg'];
      const version = createHash('sha256').update(JSON.stringify(Object.entries(bundle).map(([k, v]) => [k, 'code' in v ? v.code : v.source.toString()]))).digest('hex').slice(0, 16);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(version, assets) });
    },
  };
}

function swSource(version: string, assets: string[]): string {
  return `// 生成ファイル。build/plugins.ts を編集すること。
const VERSION = ${JSON.stringify(version)};
const CACHE = 'reading-notes-' + VERSION;
const ASSETS = ${JSON.stringify(assets)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(new URL(a, self.registration.scope), { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('reading-notes-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'status') {
    caches.open(CACHE).then(async (c) => {
      const keys = await c.keys();
      event.source?.postMessage({ type: 'status', version: VERSION, ready: keys.length >= ASSETS.length });
    });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        const hit = await cache.match(new URL('./', self.registration.scope));
        if (hit) return hit;
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit ?? fetch(req);
    })(),
  );
});
`;
}
