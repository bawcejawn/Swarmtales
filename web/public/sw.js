/*
 * SwarmTales service worker: lets the site open without a connection and be
 * installed on a phone's home screen. It only caches this site's own files
 * (the page, scripts, styles, fonts, icons, Terms). It never touches the
 * blockchain node or wallet requests: those always go to the network.
 * Story text read earlier is kept by the page itself (src/lib/offline.js).
 */
const SHELL = "st-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(["./", "./manifest.webmanifest", "./favicon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("st-shell-") && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The page itself: the network first, so a new release shows at once; the saved copy when offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(SHELL).then((cache) => cache.put("./", response.clone()));
      return response;
    }).catch(() => caches.match("./")));
    return;
  }
  // Built files have a content hash in their name, so a saved copy is always right.
  if (url.pathname.includes("/assets/")) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) caches.open(SHELL).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
    return;
  }
  // Everything else (Terms, icons, feeds): the network first, the saved copy when offline.
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) caches.open(SHELL).then((cache) => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request)));
});
