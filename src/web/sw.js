// Keeps UniLink working offline and installable. Everything a visitor saves is already in their
// browser, so only the site's own files need keeping. vite.config.ts fills in the file list.
// __FILES__ and __VERSION__ aren't variables. vite.config.ts replaces these words with
// the real file list and hash when it builds, so this file only runs in its built form.
const FILES = __FILES__;
const CACHE = `unilink-${__VERSION__}`;

// In a service worker, `self` is the worker itself.
// install runs once for each new version of this file.
self.addEventListener('install', (event) => {
  // waitUntil keeps the worker alive until the promise settles. If caching
  // fails, the install fails and the previous worker stays in charge.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', ...FILES]))
      // A new worker normally waits until every tab using the old
      // one has closed. skipWaiting lets it take over at once.
      .then(() => self.skipWaiting()),
  );
});

// One cache per deploy: the old version's files go as soon as a new one takes over.
// activate runs when this version takes over, so old caches
// are deleted only once the new files are safely stored.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('unilink-') && name !== CACHE).map((name) => caches.delete(name))))
      // Takes control of tabs that are already open, so they use this worker without a reload.
      .then(() => self.clients.claim()),
  );
});

// Stores a response in this version's cache.
const keep = (key, response) => caches.open(CACHE).then((cache) => cache.put(key, response));

// Every request the page makes passes through here. Calling event.respondWith()
// answers it; returning without calling it lets the browser fetch as usual.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only GET requests to this site are handled. Anything else goes straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // The page: the newest one if there's a network, so nobody gets stuck on an old version.
  // A navigate request is the page itself: typing the address, following a link or reloading.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // A response body can only be read once, so it's cloned:
          // one copy for the cache, the other for the page.
          if (response.ok) keep('./', response.clone());
          return response;
        })
        // fetch() rejects when there's no network. Then the kept copy of the page is used.
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Everything else has a hash in its name or changes only with a deploy, so a kept copy is right,
  // whatever Vary header a host sends with it (scripts are requested differently from how they're kept).
  event.respondWith(
    // `kept ?? fetch(…)`: the cached copy if there is one,
    // otherwise the network, keeping what comes back.
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
