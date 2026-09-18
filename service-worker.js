/**
 * Daily Portfolio Snapshot - service-worker.js
 * Enables offline caching and PWA functionality
 */

const CACHE_NAME = 'dps-cache-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './standalone.html',
  './modular.html',
  './styles.css',
  './main.js',
  './manifest.json',
  './icons/icon.svg'
];

// Install Event: Cache critical app shell resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching static app shell');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Cache-first for app shell, Network-first with graceful fallback for external calls
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // For API calls to Twelve Data: attempt network first; if offline, return a fallback JSON or error
  if (requestUrl.hostname.includes('twelvedata.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            status: 'offline',
            message: 'オフラインのためローカルキャッシュの相場データを利用します'
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // For local static assets: Cache-First strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache newly fetched valid responses
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If navigating and offline, return the cached index.html
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
