// ─── S.S.G PWA Service Worker ──────────────────────────────────────────────
// Version: 1.0.0
// Cache name includes version for easy cache busting
const CACHE_NAME = 'ssg-pwa-v1';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/css/style.css',
  '/css/dashboard.css',
  '/js/dashboard.js',
  '/images/ssg-logo.gif',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

// ─── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        return self.skipWaiting();
      })
      .catch((err) => {
        console.log('[SW] Pre-cache failed (some assets may be unavailable offline):', err.message);
      })
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// ─── FETCH (Network-first, fallback to cache) ─────────────────────────────────
// API calls always go to network. Static assets use network-first with cache fallback.
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API calls — always go to network
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip Torn API calls
  if (url.hostname === 'api.torn.com' || url.hostname === 'ffscouter.com') {
    return;
  }

  // Network-first strategy for everything else
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses
        if (response.ok || response.type === 'opaqueredirect') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline — serve from cache
        return caches.match(request).then((cached) => {
          return cached || new Response('Offline', { status: 503 });
        });
      })
  );
});