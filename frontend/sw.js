/* ============================================================
   RMS-MIS — Service Worker v5
   Production-ready: caching, offline, push, background sync
   ============================================================ */

const CACHE_NAME = 'rms-mis-v5';
const APP_SHELL = [
  '/',
  '/index.html',
  '/public/logo.webp',
  '/public/icon-192.svg',
  '/public/icon-512.svg',
  '/public/favicon.svg',
  '/css/styles.css',
  '/css/report-card.css',
  '/css/student-report-card.css',
  '/css/report-wizard.css',
  '/js/config.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/utils.js',
  '/js/router.js',
  '/js/realtime.js',
  '/js/components/ui.js',
  '/js/components/sidebar.js',
  '/js/pages/admin-dashboard.js',
  '/js/pages/admin-teachers.js',
  '/js/pages/admin-classes.js',
  '/js/pages/admin-subjects.js',
  '/js/pages/admin-assessments.js',
  '/js/pages/admin-marks.js',
  '/js/pages/admin-reports.js',
  '/js/pages/teacher-pages.js',
  '/js/pages/teacher-enter-marks.js',
  '/js/pages/teacher-account.js',
  '/js/app.js',
  '/js/welcome-notification.js',
  '/js/charts.js',
  '/js/analytics-engine.js',
  '/js/marks-import.js',
  '/js/sync-registry.js',
  '/manifest.webmanifest',
  '/manifest.json'
];

const OFFLINE_URL = '/index.html';

/* ---------- Install ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ---------- Activate ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- Fetch ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  /* Skip non-GET requests */
  if (request.method !== 'GET') return;

  /* Skip Supabase requests — always network-first */
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(networkFirst(request));
    return;
  }

  /* Skip Edge Function requests */
  if (url.hostname.includes('vercel.app') && url.pathname.includes('/functions/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  /* App shell — cache-first */
  if (APP_SHELL.some((p) => url.pathname === p || url.pathname.startsWith(p + '?'))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Public assets — cache-first */
  if (url.pathname.startsWith('/public/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Everything else — network-first with cache fallback */
  event.respondWith(networkFirst(request));
});

/* ---------- Cache Strategies ---------- */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return caches.match(OFFLINE_URL);
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/* ---------- Push Notifications ---------- */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'RMS-MIS', message: 'New notification' };
  }

  const title = data.title || 'RMS-MIS';
  const options = {
    body: data.message || 'You have a new notification',
    icon: '/public/icon-192.svg',
    badge: '/public/icon-192.svg',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      notificationId: data.notificationId
    },
    actions: [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ---------- Notification Click ---------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const client = clientList.find((c) => c.url === url && 'focus' in c);
      if (client) {
        return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

/* ---------- Background Sync ---------- */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-notifications') {
    event.waitUntil(syncNotifications());
  }
});

async function syncNotifications() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    /* Revalidate cached pages */
    await Promise.all(
      requests.map((req) => fetch(req).catch(() => {}))
    );
  } catch (e) {
    console.warn('[SW] Background sync failed:', e);
  }
}

/* ---------- Message Handler ---------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_CACHE_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[RMS-MIS SW v5] Service worker loaded');
