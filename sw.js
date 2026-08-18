const CACHE = "aa-v66";
const PREFIX = "aa-";   // PASS 39 [39-4] — this app owns ONLY its own caches
if (CACHE.indexOf(PREFIX) !== 0) throw new Error("cache name does not carry its own prefix");
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./favicon.png", "./pdf.min.js", "./pdf.worker.min.js", "./qr.js", "./jsqr.js", "./zxing.js"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
// PASS 39 [39-4] — CacheStorage is scoped to the ORIGIN, not the path, and all
// three apps live on arcadapt.github.io. "delete everything that is not me"
// therefore deleted the OTHER TWO APPS, and a technician who had opened Arc
// Adapt could not open EverDue offline at all. Filter on this app's own prefix.
//
// PREFIX is declared, not derived from CACHE by regex: a derivation is one typo
// away from matching everything, and this is the line that deletes things.
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.indexOf(PREFIX) === 0 && k !== CACHE).map(k => caches.delete(k))))
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
// PASS 39 [39-5, declared addition] — caches.match() with no cacheName searches
// EVERY cache in the origin, so this app could answer with another app's
// document. The cacheName option scopes it. Written as an option rather than
// caches.open(CACHE).then(c => c.match(...)) so the literal caches.match( stays
// where test_swfresh's static check reads it to prove assets are cache-first.
// PASS 40 [40-1a] — the fallback used to name ONE key. If that exact entry was
// the missing one it resolved undefined, and respondWith(undefined) is a
// network error: the app refused to open offline while its own document sat in
// the cache under "./". addAll(ASSETS) writes BOTH keys on install, so trying
// both means either survivor is enough. Ordered index.html first only because
// that is the key that is normally present; neither is preferred.
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true, cacheName: CACHE })
    .then(hit => hit
      || caches.match("./index.html", { cacheName: CACHE })
      || null)
    .then(hit => hit || caches.match("./", { cacheName: CACHE }));
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
          // PASS 39 [39-5] — resp.ok. One reload behind a captive portal used to
          // write "Sign in to continue" into the cache AS THE APP, and it was
          // served offline from then on. A 404 cached as the app the same way.
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return resp;
        }),
        new Promise(res => setTimeout(() => res(null), NAV_TIMEOUT_MS))
      ]).then(r => r || fromCache(e.request)).catch(() => fromCache(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true, cacheName: CACHE }).then(hit =>
      hit ||
      fetch(e.request).then(resp => {
        // PASS 39 [39-5] — same status check as the navigation branch.
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      // PASS 40 [40-1b] — THIS LINE IS WHY Tesseract COULD VANISH SILENTLY.
      // It used to return the app document here, so a missing asset came back
      // 200 text/html; the browser sees a success with a body and fires
      // ONLOAD on a <script> that never loaded. Every asset-load error path in
      // the app was therefore dead code. A 504 is a real failure the loader
      // can see. Chosen over Response.error() because it is inspectable in
      // devtools and a test can assert on the status.
      }).catch(() => new Response("", {
        status: 504, statusText: "offline and not cached"
      }))
    )
  );
});
