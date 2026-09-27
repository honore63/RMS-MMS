const CACHE_NAME = 'rms-mis-v4';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/styles.css',
  '/css/report-card.css',
  '/css/student-report-card.css',
  '/css/report-wizard.css',
  '/css/communications.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/utils.js',
  '/js/router.js',
  '/js/realtime.js',
  '/js/config.js',
  '/js/components/ui.js',
  '/js/components/sidebar.js',
  '/js/pages/teacher-enter-marks.js',
  '/js/pages/teacher-convert-marks.js',
  '/js/pages/teacher-pages.js',
  '/js/pages/communications.js',
  '/js/pages/admin-dashboard.js',
  '/js/pages/admin-assessments.js',
  '/js/pages/admin-classes.js',
  '/js/pages/admin-subjects.js',
  '/js/pages/admin-teachers.js',
  '/js/pages/admin-learners.js',
  '/js/pages/admin-marks.js',
  '/js/pages/analytics.js',
  '/js/reports/report-header.js',
  '/js/reports/report-engine.js',
  '/js/reports/report-wizard.js',
  '/js/pages/teacher-account.js',
  '/js/pages/teacher-analytics.js',
  '/public/logo.webp',
  '/public/icon-192.svg',
  '/public/icon-512.svg'
];

const RUNTIME_CACHE = 'rms-mis-runtime-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME && key !== RUNTIME_CACHE).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip Supabase requests — always network first for real-time data
  if (url.hostname.includes('supabase.co') || url.hostname.includes('vercel.app')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Skip API routes
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Return cached, but also update in background
        fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
          }
        }).catch(() => {});
        return cached;
      }

      return fetch(request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return caches.match('/public/logo.webp');
      });
    })
  );
});

// Background sync for notifications
self.addEventListener('sync', event => {
  if (event.tag === 'notifications-sync') {
    event.waitUntil(
      clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SYNC_NOTIFICATIONS' });
        });
      })
    );
  }
});

// Push notifications
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'RMS-MIS Notification';
  const options = {
    body: data.message || 'You have a new notification.',
    icon: '/public/icon-192.svg',
    badge: '/public/icon-192.svg',
    vibrate: [100, 50, 100],
    data: { url: data.action_url || '/' },
    actions: [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      const hasWindow = clientsArr.some(client => client.url.includes(url));
      if (hasWindow) {
        clientsArr.forEach(client => client.focus());
      } else {
        clients.openWindow(url);
      }
    })
  );
});
