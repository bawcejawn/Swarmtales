/*
 * SwarmTales service worker: lets the site open without a connection and be
 * installed on a phone's home screen. It only caches this site's own files
 * (the page, scripts, styles, fonts, icons, Terms). It never touches the
 * blockchain node or wallet requests: those always go to the network.
 * Story text read earlier is kept by the page itself (src/lib/offline.js).
 */
// One cache per release: the page registers this file as sw.js?build=<commit>,
// so each deploy installs afresh and the last release's files are deleted.
const BUILD = (new URL(self.location.href).searchParams.get("build") || "dev").replace(/[^\w.-]/g, "").slice(0, 40);
const SHELL = "st-shell-" + BUILD;

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
    // Only the site's own page is kept as the offline copy: opening a feed,
    // the Terms or an icon directly must not replace it.
    const scope = new URL(self.registration.scope).pathname;
    const isApp = url.pathname === scope || url.pathname === scope + "index.html";
    event.respondWith(fetch(request).then((response) => {
      const html = (response.headers.get("content-type") || "").includes("text/html");
      if (isApp && response.ok && html) {
        const copy = response.clone();
        caches.open(SHELL).then((cache) => cache.put("./", copy));
      }
      return response;
    }).catch(() => (isApp ? caches.match("./") : caches.match(request))));
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
