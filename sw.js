// Sin conexión: guarda la app en caché. Los archivos propios se piden primero a internet (para coger siempre la última versión)
// y, si no hay conexión, se sirven desde la caché. Las librerías externas (Firebase, fuentes) se sirven desde la caché.
const CACHE = "procop-v2";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./firebase-config.js", "./cloud.js", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  const lib = url.hostname === "www.gstatic.com" || url.hostname.startsWith("fonts.g");
  if (!own && !lib) return; // Firestore, autenticación…: siempre a internet
  if (own) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req.mode === "navigate" ? "./index.html" : req, c)); } return r; })
      .catch(() => caches.match(req.mode === "navigate" ? "./index.html" : req)));
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })));
  }
});
