/*
 * Service worker voor Janka's Appie.
 * - Cachet de app-shell voor offline gebruik.
 * - Best-effort periodic background sync: als de browser dit ondersteunt en toestaat,
 *   wordt hier periodiek gecontroleerd op nieuwe items en een melding getoond.
 *   Geen enkele garantie: dit draait alleen zolang de browser het toestaat, er is
 *   geen server die dit afdwingt (bewust, om zonder eigen backend te werken).
 */

const CACHE_NAME = "jankas-appie-v4";
const APP_SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/app.js",
  "js/datasources.js",
  "js/map.js",
  "js/notifications.js",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  // Alleen de eigen app-shell uit cache serveren; databronnen (Overpass/Wikidata/etc.) altijd live ophalen.
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

self.addEventListener("periodicsync", event => {
  if (event.tag === "check-nearby-events") {
    event.waitUntil(checkNearbyEventsInBackground());
  }
});

async function checkNearbyEventsInBackground() {
  // Achtergrond-taken hebben geen toegang tot de pagina-state; we bewaren daarom
  // laatst bekende locatie/instellingen niet apart voor de service worker in v1.
  // Deze hook staat klaar voor uitbreiding; zie README voor de huidige beperking.
}
