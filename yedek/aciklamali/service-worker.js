// Uygulamanın temel dosyalarını ilk açılışta önbelleğe alıp çevrimdışı erişim sağlar.
const CACHE_NAME = 'hatirlaticilarim-ios-v15';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app-icon.svg',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_FILES);
      const page = await cache.match('./index.html');
      if (!page) {
        throw new Error('Uygulama giriş sayfası önbelleğe alınamadı.');
      }

      const html = await page.text();
      const pageAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map(([, reference]) => new URL(reference, self.location.href))
        .filter((assetUrl) => assetUrl.origin === self.location.origin)
        .map((assetUrl) => assetUrl.href);
      await cache.addAll([...new Set(pageAssets)]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter(
            (cacheName) =>
              cacheName.startsWith('hatirlaticilarim-') && cacheName !== CACHE_NAME
          )
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', responseCopy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((response) => {
        if (response.ok) {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy));
        }
        return response;
      });
    })
  );
});
