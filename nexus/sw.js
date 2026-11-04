// NEXUS : garde la page en cache pour l'ouvrir hors connexion, toujours en version fraîche si le réseau répond.
const CACHE = "nexus-v9";
const FICHIERS = ["./", "index.html", "manifest.webmanifest", "icone.svg", "icone-180.png", "icone-192.png", "icone-512.png",
  "ploutos.css?v=5", "ploutos-moteur.js?v=5", "ploutos-coffre.js?v=5", "ploutos.js?v=5"];

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

// Notifications envoyées par le robot NEXUS (Web Push). Le contenu arrive chiffré, le navigateur le déchiffre.
self.addEventListener("push", (e) => {
  let n = { titre: "NEXUS", corps: "", url: "./" };
  try { n = { ...n, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(n.titre, {
    body: n.corps, icon: "icone-192.png", badge: "icone-192.png", tag: n.tag || undefined, data: { url: n.url || "./" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const cible = new URL(e.notification.data && e.notification.data.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
    for (const f of fenetres) if (f.url.startsWith(self.registration.scope)) { f.navigate(cible).catch(() => {}); return f.focus(); }
    return self.clients.openWindow(cible);
  }));
});
