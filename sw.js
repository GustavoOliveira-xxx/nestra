const VERSION = 'nestra-v13';
const SHELL = VERSION + '-shell';
const RUNTIME = VERSION + '-runtime';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/tokens.css',
  './css/base.css',
  './css/animations.css',
  './css/loader.css',
  './css/layout.css',
  './css/components.css',
  './css/views.css',
  './css/fx.css',
  './css/meetings.css',
  './js/main.js',
  './js/core/gl.js',
  './js/core/device.js',
  './js/gfx/logo3d.js',
  './js/gfx/scene.js',
  './js/gfx/fx.js',
  './js/gfx/interactions.js',
  './js/gfx/shapes.js',
  './js/gfx/complete.js',
  './js/gfx/orb.js',
  './js/gfx/envhero.js',
  './js/app/api.js',
  './js/app/store.js',
  './js/app/nlp.js',
  './js/app/voice.js',
  './js/app/ui.js',
  './js/app/copilot.js',
  './js/app/views/meetings.js',
  './js/app/views/capture.js',
  './js/app/views/items.js',
  './js/app/views/today.js',
  './js/app/views/environments.js',
  './js/app/views/settings.js',
  './assets/logo/nestra-mark.png',
  './assets/logo/nestra-logo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/favicon-64.png',
  './assets/icons/apple-touch-icon.png',
  './assets/fonts/InterVariable.woff2',
  './assets/fonts/SpaceGrotesk-Variable.ttf',
  './assets/fonts/JetBrainsMono-Regular.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch((err) => console.warn('[nestra sw] casca parcial:', err))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.pathname.includes('/api/')) return;

  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  const guardar = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      caches.open(RUNTIME).then((c) => c.put(request, copy));
    }
    return res;
  };

  if (/\.(js|css|json|html)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then(guardar)
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then(guardar).catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Nestra', {
      body: payload.body || '',
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: payload.tag || 'nestra',
      data: { url: payload.url || './index.html#/hoje' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || './index.html#/hoje';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'nestra-sync') {
    event.waitUntil(
      self.clients.matchAll().then((list) =>
        list.forEach((c) => c.postMessage({ type: 'flush-queue' }))),
    );
  }
});
