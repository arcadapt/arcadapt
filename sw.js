const CACHE = "aa-v33";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./favicon.png", "./pdf.min.js", "./pdf.worker.min.js", "./qr.js", "./jsqr.js", "./zxing.js"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
const NAV_TIMEOUT_MS = 3000;
// The document, and only the document, is fetched fresh when there is a network.
// Cache-first on the HTML is why a new build took TWO loads to appear: load one
// installed the new worker but was itself served from the old cache. Measured on
// 31 Jul 2026 as {"badge":"V0.03 beta","build":"aa-v6","caches":["aa-v7"]}.
// Assets stay cache-first — they are content-stable and the app has to open in a
// basement with no signal.
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("./index.html"));
}
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // NEVER intercept cross-origin calls (geocoding/routing APIs): ignoreSearch matching
  // was serving the FIRST map lookup's cached answer for EVERY site (C7.1 fix)
  if (new URL(e.request.url).origin !== location.origin) return;
  if (e.request.mode === "navigate" || e.request.destination === "document") {
    e.respondWith(
      // cache:"reload" bypasses the BROWSER's own HTTP cache, not just ours.
      // GitHub Pages serves HTML with a max-age, so a plain fetch() here can be
      // answered from the HTTP cache with the pre-deploy document and the whole
      // point of this branch is lost for the length of that max-age. Found by
      // test_swfresh, which caught a stale document coming back from a server
      // that was merely honouring If-Modified-Since.
      Promise.race([
        fetch(e.request.url, { cache: "reload", credentials: "same-origin" }).then(resp => {
          // Cache it either way: if the timeout already won, the NEXT load still
          // gets the fresh copy instead of waiting on the network again.
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return resp;
        }),
        new Promise(res => setTimeout(() => res(null), NAV_TIMEOUT_MS))
      ]).then(r => r || fromCache(e.request)).catch(() => fromCache(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit ||
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
