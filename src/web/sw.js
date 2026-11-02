// Keeps UniLink working offline and installable. Everything a visitor saves is already in their
// browser, so only the site's own files need keeping. vite.config.ts fills in the file list.
const FILES = __FILES__;
const CACHE = `unilink-${__VERSION__}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', ...FILES]))
      .then(() => self.skipWaiting()),
  );
});

// One cache per deploy: the old version's files go as soon as a new one takes over.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('unilink-') && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

const keep = (key, response) => caches.open(CACHE).then((cache) => cache.put(key, response));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // The page: the newest one if there's a network, so nobody gets stuck on an old version.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) keep('./', response.clone());
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Everything else has a hash in its name or changes only with a deploy, so a kept copy is right,
  // whatever Vary header a host sends with it (scripts are requested differently from how they're kept).
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (kept) =>
        kept ??
        fetch(request).then((response) => {
          if (response.ok) keep(request, response.clone());
          return response;
        }),
    ),
  );
});
