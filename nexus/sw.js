// NEXUS : garde la page en cache pour l'ouvrir hors connexion, toujours en version fraîche si le réseau répond.
const CACHE = "nexus-v1";
const FICHIERS = ["./", "index.html", "manifest.webmanifest", "icone.svg", "icone-192.png", "icone-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) {
        const copie = r.clone();
        const cle = url.pathname.endsWith("donnees.json") ? "donnees.json" : e.request;
        caches.open(CACHE).then((c) => c.put(cle, copie));
      }
      return r;
    }).catch(() => caches.match(url.pathname.endsWith("donnees.json") ? "donnees.json" : e.request))
  );
});
