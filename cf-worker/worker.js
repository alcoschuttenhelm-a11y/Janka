/*
 * Janka's Appie — NL feesten/kermis/jaarmarkt-proxy (Cloudflare Worker)
 *
 * Doel: ontsluit de Nederlandse jaarmarkten/braderieën-agenda van wattedoenin.nl als
 * CORS-vriendelijke JSON-API, zodat de PWA dit client-side kan gebruiken zonder dat de
 * PWA zelf iets hoeft te scrapen (browsers staan cross-origin scraping niet toe).
 *
 * Bron: https://www.wattedoenin.nl/jaarmarkten-braderieen/ — deze pagina publiceert
 * evenementen in gestandaardiseerde schema.org/Event-microdata (naam, startDate/endDate,
 * locatie met lat/lon). Dat is hetzelfde machine-leesbare format dat zoekmachines
 * gebruiken voor rich snippets — deze Worker leest dus bestaande, voor machine-parsing
 * bedoelde structured data, geen ruwe pagina-scraping van vrije tekst.
 *
 * robots.txt van wattedoenin.nl staat User-agent:* toe op deze pagina (blokkeert alleen
 * een lijst specifieke bekende bots + /test/). Resultaten worden 1 uur gecached (Cloudflare
 * Cache API) zodat de bron niet bij elke app-request opnieuw belast wordt.
 *
 * Let op: dit leunt op de huidige HTML-structuur van wattedoenin.nl. Als de site haar
 * opmaak wijzigt, kan de parsing stoppen met werken — controleer dan de selectors hieronder.
 */

const SOURCE_URL = "https://www.wattedoenin.nl/jaarmarkten-braderieen/";
const CACHE_TTL_SECONDS = 3600;

function toRad(deg) { return (deg * Math.PI) / 180; }

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=UTF-8"
  };
}

// Verzamelt schema.org/Event-microdata terwijl HTMLRewriter door de pagina streamt.
class EventCollector {
  constructor() {
    this.events = [];
    this.current = null;
  }
  startEvent() {
    this.current = {
      name: null, startDate: null, endDate: null,
      locationName: null, locality: null, lat: null, lon: null,
      description: "", url: null
    };
    this.events.push(this.current);
  }
}

class StartEventHandler {
  constructor(collector) { this.collector = collector; }
  element() { this.collector.startEvent(); }
}

// Accumuleert alle tekst tussen open- en sluit-tag van het geselecteerde element
// (ook uit eventuele geneste elementen, bv. een link middenin een omschrijving),
// en schrijft pas weg bij de sluit-tag — zo overschrijft een geneste tekstnode niet
// de al verzamelde tekst ervoor.
class TextSetter {
  constructor(collector, field) { this.collector = collector; this.field = field; }
  element(el) {
    const target = this.collector.current;
    this.buf = "";
    el.onEndTag(() => {
      const value = this.buf.trim();
      if (target && value) target[this.field] = value;
    });
  }
  text(chunk) {
    this.buf += chunk.text;
  }
}

class AttrSetter {
  constructor(collector, field, attr, transform) {
    this.collector = collector; this.field = field; this.attr = attr;
    this.transform = transform || (v => v);
  }
  element(el) {
    const value = el.getAttribute(this.attr);
    if (value != null && this.collector.current && this.collector.current[this.field] == null) {
      this.collector.current[this.field] = this.transform(value);
    }
  }
}

async function fetchAndParseEvents() {
  const cache = caches.default;
  const cacheKey = new Request(SOURCE_URL);
  let cached = await cache.match(cacheKey);
  if (cached) {
    return await cached.json();
  }

  const sourceRes = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JankasAppieBot/1.0; +https://alcoschuttenhelm-a11y.github.io/Janka/)" }
  });
  if (!sourceRes.ok) throw new Error("Bron niet bereikbaar: " + sourceRes.status);

  const collector = new EventCollector();
  const rewriter = new HTMLRewriter()
    .on("div.evenement", new StartEventHandler(collector))
    .on("div.evenement h3 span[itemprop=\"name\"]", new TextSetter(collector, "name"))
    .on("div.evenement span[itemtype=\"http://schema.org/Place\"] span[itemprop=\"name\"]", new TextSetter(collector, "locationName"))
    .on("div.evenement span[itemprop=\"addressLocality\"]", new TextSetter(collector, "locality"))
    .on("div.evenement span[itemprop=\"description\"]", new TextSetter(collector, "description"))
    .on("div.evenement meta[itemprop=\"startDate\"]", new AttrSetter(collector, "startDate", "content"))
    .on("div.evenement meta[itemprop=\"endDate\"]", new AttrSetter(collector, "endDate", "content"))
    .on("div.evenement meta[itemprop=\"latitude\"]", new AttrSetter(collector, "lat", "content", parseFloat))
    .on("div.evenement meta[itemprop=\"longitude\"]", new AttrSetter(collector, "lon", "content", parseFloat))
    .on("div.evenement a[itemprop=\"url\"]", new AttrSetter(collector, "url", "href"));

  const transformed = rewriter.transform(sourceRes);
  await transformed.text(); // forceert volledige verwerking van de stream

  const events = collector.events
    .filter(e => e.name && e.lat != null && e.lon != null)
    .map((e, i) => ({
      id: "watte-" + i + "-" + (e.startDate || ""),
      title: e.name,
      category: guessCategory(e.name, e.description),
      lat: e.lat,
      lon: e.lon,
      locality: e.locality,
      startDate: e.startDate,
      endDate: e.endDate,
      description: e.description,
      source: "wattedoenin.nl",
      url: e.url
    }));

  const body = JSON.stringify({ fetchedAt: new Date().toISOString(), events });
  const cacheResponse = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + CACHE_TTL_SECONDS } });
  await cache.put(cacheKey, cacheResponse.clone());
  return JSON.parse(body);
}

function guessCategory(name, description) {
  const text = (name + " " + description).toLowerCase();
  if (text.includes("kermis")) return "kermis";
  if (text.includes("braderie")) return "braderie";
  if (text.includes("jaarmarkt") || text.includes("markt")) return "markt";
  return "evenement";
}

async function handleRequest(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  if (url.pathname !== "/events") {
    return new Response(JSON.stringify({ error: "Gebruik /events?lat=..&lon=..&radiusKm=..&days=.." }), {
      status: 404, headers: corsHeaders()
    });
  }

  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  const radiusKm = parseFloat(url.searchParams.get("radiusKm") || "10");
  const days = parseFloat(url.searchParams.get("days") || "7");

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return new Response(JSON.stringify({ error: "lat en lon zijn verplicht" }), {
      status: 400, headers: corsHeaders()
    });
  }

  try {
    const { events } = await fetchAndParseEvents();
    const now = Date.now();
    const until = now + days * 86400000;

    const filtered = events
      .map(e => ({ ...e, distanceKm: distanceKm(lat, lon, e.lat, e.lon) }))
      .filter(e => e.distanceKm <= radiusKm)
      .filter(e => {
        if (!e.startDate) return true;
        const t = new Date(e.startDate).getTime();
        return t <= until;
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return new Response(JSON.stringify({ events: filtered }), { headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers: corsHeaders() });
  }
}

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
