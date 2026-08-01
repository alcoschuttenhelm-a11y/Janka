/*
 * Haalt Nederlandse markten/braderieën/jaarmarkten op bij 4 bronnen en schrijft ze weg als
 * één statisch bestand (data/nl-markten.json), zodat de PWA dit met één simpele fetch kan
 * inladen zonder zelf te hoeven scrapen of tegen CORS aan te lopen.
 *
 * Draait server-side (GitHub Actions) — daar bestaat geen CORS-beperking, dus dit kan
 * rechtstreeks bij de bronnen ophalen zonder Cloudflare Worker/proxy.
 *
 * Bronnen:
 * - marktenmeer.nl, evenementenlijst.nl, wildro.nl: draaien op de WordPress-plugin
 *   "The Events Calendar" met een officiële REST API (/wp-json/tribe/events/v1/events).
 *   Geen coördinaten in de respons — worden hieronder geocodeerd.
 * - marbo.nl: HTML-tabel (kraamverhuur-boekingsformulier), maar bevat gewoon echte
 *   markt-locaties+data die ook voor bezoekers relevant zijn. Wordt met een gerichte
 *   regex geparsed (geen generieke HTML-scraper nodig, structuur is stabiel/eenvoudig).
 *
 * Geocoding: PDOK Locatieserver (gratis, CORS-bevestigd, geen sleutel nodig) voor
 * Nederlandse adressen. Resultaten worden gecached in scripts/geocode-cache.json zodat
 * niet elke dag alles opnieuw geocodeerd hoeft te worden.
 */

const fs = require("fs/promises");
const path = require("path");

const EVENTS_CALENDAR_SITES = ["marktenmeer.nl", "evenementenlijst.nl", "wildro.nl"];
const MARBO_URL = "https://marbo.nl/markten-2026/"; // LET OP: jaartal in URL, moet jaarlijks bijgewerkt worden
const GEOCODE_CACHE_PATH = path.join(__dirname, "geocode-cache.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "nl-markten.json");

const WINDOW_DAYS = 21; // hoeveel dagen vooruit opgehaald wordt (ruim boven de max. 14 dagen die de app toont)
const USER_AGENT = "Mozilla/5.0 (compatible; JankasAppieDataBot/1.0; +https://alcoschuttenhelm-a11y.github.io/Janka/)";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&#8211;/g, "–").replace(/&#8217;/g, "'").replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ").replace(/&#038;/g, "&").replace(/&quot;/g, '"');
}

function guessCategory(title, description = "") {
  const text = (title + " " + description).toLowerCase();
  if (text.includes("kermis")) return "kermis";
  if (text.includes("braderie")) return "braderie";
  if (text.includes("jaarmarkt") || text.includes("markt")) return "markt";
  return "evenement";
}

// --- Bron 1-3: The Events Calendar REST API (marktenmeer.nl, evenementenlijst.nl, wildro.nl) ---
async function fetchEventsCalendarSite(domain, startDate, endDate) {
  const items = [];
  let page = 1;
  while (true) {
    const url = `https://${domain}/wp-json/tribe/events/v1/events?start_date=${startDate}&end_date=${endDate}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) {
      console.warn(`[${domain}] HTTP ${res.status} op pagina ${page}, stop met deze bron.`);
      break;
    }
    const data = await res.json();
    const events = data.events || [];
    events.forEach(ev => {
      const venue = ev.venue || {};
      const venueLabel = [venue.venue, venue.address, venue.city].filter(Boolean).join(", ");
      items.push({
        id: `ec-${domain}-${ev.id}`,
        title: decodeHtmlEntities(ev.title || "Markt"),
        category: guessCategory(ev.title || "", ev.description || ""),
        venueKey: venueLabel || venue.city || domain,
        date: ev.start_date ? ev.start_date.replace(" ", "T") : null,
        source: domain,
        url: ev.url || null
      });
    });
    console.log(`[${domain}] pagina ${page}: ${events.length} events`);
    if (events.length < 100) break; // laatste pagina bereikt
    page++;
    if (page > 30) { console.warn(`[${domain}] stop na 30 pagina's (veiligheidslimiet)`); break; }
  }
  return items;
}

// --- Bron 4: marbo.nl (HTML-boekingstabel) ---
async function fetchMarboMarkten() {
  const res = await fetch(MARBO_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    console.warn(`[marbo.nl] HTTP ${res.status}, sla deze bron over.`);
    return [];
  }
  const html = await res.text();

  const items = [];
  const rowRegex = /<tr data-selectedid="(\d+)" class="(even|odd)">([\s\S]*?)<\/tr>/g;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[3];
    const dateMatch = /value="[^;"]*;(\d{2})-(\d{2})-(\d{4})"/.exec(rowHtml);
    const nameMatch = /<\/td>\s*<td>([^<]+)<br/.exec(rowHtml);
    if (!dateMatch || !nameMatch) continue; // bv. rijen zonder geldige datum/naam overslaan

    const [, dd, mm, yyyy] = dateMatch;
    const name = decodeHtmlEntities(nameMatch[1].trim());
    items.push({
      id: `marbo-${match[1]}`,
      title: name,
      category: guessCategory(name),
      venueKey: name,
      date: `${yyyy}-${mm}-${dd}T00:00:00`,
      source: "marbo.nl",
      url: MARBO_URL
    });
  }
  console.log(`[marbo.nl] ${items.length} markten gevonden`);
  return items;
}

// --- Geocoding via PDOK Locatieserver, met cache ---
async function loadGeocodeCache() {
  try {
    return JSON.parse(await fs.readFile(GEOCODE_CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function geocode(query) {
  const url = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?rows=1&q=" + encodeURIComponent(query + " Nederland");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.response?.docs?.[0];
  if (!doc?.centroide_ll) return null;
  const match = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(doc.centroide_ll);
  if (!match) return null;
  return { lat: parseFloat(match[2]), lon: parseFloat(match[1]) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocodeAll(items) {
  const cache = await loadGeocodeCache();
  const uniqueKeys = [...new Set(items.map(it => it.venueKey))];
  const newKeys = uniqueKeys.filter(k => !(k in cache));

  console.log(`${uniqueKeys.length} unieke locaties, ${newKeys.length} nog niet in cache.`);
  for (const key of newKeys) {
    cache[key] = await geocode(key);
    await sleep(150); // beleefd tempo richting PDOK
  }
  await fs.writeFile(GEOCODE_CACHE_PATH, JSON.stringify(cache, null, 2));

  const geocoded = items
    .map(it => ({ ...it, ...(cache[it.venueKey] || {}) }))
    .filter(it => it.lat != null && it.lon != null);

  console.log(`${geocoded.length}/${items.length} events hebben coördinaten (rest kon niet geocodeerd worden).`);
  return geocoded;
}

async function main() {
  const startDate = todayIso();
  const endDate = addDays(startDate, WINDOW_DAYS);

  let items = [];
  for (const domain of EVENTS_CALENDAR_SITES) {
    items = items.concat(await fetchEventsCalendarSite(domain, startDate, endDate));
  }
  items = items.concat(await fetchMarboMarkten());

  const geocoded = await geocodeAll(items);

  const output = geocoded.map(({ id, title, category, lat, lon, date, source, url }) => ({
    id, title, category, lat, lon, date, source, url
  }));

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), events: output }, null, 2));
  console.log(`Klaar: ${output.length} events weggeschreven naar ${OUTPUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
