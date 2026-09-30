/*
 * Haalt Nederlandse markten/braderieën/jaarmarkten op bij 4 bronnen en schrijft ze weg als
 * één statisch bestand (data/nl-markten.json), zodat de PWA dit met één simpele fetch kan
 * inladen zonder zelf te hoeven scrapen of tegen CORS aan te lopen.
 *
 * Draait server-side (GitHub Actions) — daar bestaat geen CORS-beperking, dus dit kan
 * rechtstreeks bij de bronnen ophalen zonder Cloudflare Worker/proxy.
 *
 * Bronnen:
 * - marktenmeer.nl: sitemap + JSON-LD scraping (Events Calendar plugin is verwijderd,
 *   maar individuele evenementpagina's bevatten schema.org/Event JSON-LD).
 *   Haalt de sitemap-index op, filtert URLs op datum in de slug, en scrapet JSON-LD.
 * - evenementenlijst.nl, wildro.nl: draaien op de WordPress-plugin
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

const EVENTS_CALENDAR_SITES = ["evenementenlijst.nl", "wildro.nl"];
const MARKTENMEER_SITEMAP_INDEX = "https://marktenmeer.nl/sitemap_index.xml";
const MARBO_URL = "https://marbo.nl/markten-2026/"; // LET OP: jaartal in URL, moet jaarlijks bijgewerkt worden
const GEOCODE_CACHE_PATH = path.join(__dirname, "geocode-cache.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "nl-markten.json");

const WINDOW_DAYS = 21; // hoeveel dagen vooruit opgehaald wordt (ruim boven de max. 14 dagen die de app toont)
const BOT_USER_AGENT = "Mozilla/5.0 (compatible; JankasAppieDataBot/1.0; +https://alcoschuttenhelm-a11y.github.io/Janka/)";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MONTH_NAMES_NL = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];

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

// --- Bron: The Events Calendar REST API (evenementenlijst.nl, wildro.nl) ---
async function fetchEventsCalendarSite(domain, startDate, endDate) {
  const items = [];
  let page = 1;
  while (true) {
    const url = `https://${domain}/wp-json/tribe/events/v1/events?start_date=${startDate}&end_date=${endDate}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { "User-Agent": BOT_USER_AGENT, Accept: "application/json" } });
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

// --- Bron: marktenmeer.nl (sitemap + JSON-LD scraping) ---
function parseDateFromSlug(slug) {
  // Formats: "30-september-2026", "4-5-6-september-2026", "september-2026"
  const monthPattern = MONTH_NAMES_NL.join("|");
  const re = new RegExp(`(\\d{1,2})[-–](${monthPattern})[-–](20\\d{2})`, "i");
  const match = re.exec(slug);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = MONTH_NAMES_NL.indexOf(match[2].toLowerCase());
  const year = parseInt(match[3], 10);
  if (month < 0 || day < 1 || day > 31) return null;
  return new Date(year, month, day);
}

async function fetchMarktenmeerSitemapUrls(startDate, endDate) {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T23:59:59");

  const idxRes = await fetch(MARKTENMEER_SITEMAP_INDEX, { headers: { "User-Agent": BROWSER_USER_AGENT } });
  if (!idxRes.ok) {
    console.warn(`[marktenmeer.nl] Sitemap index HTTP ${idxRes.status}, sla over.`);
    return [];
  }
  const idxXml = await idxRes.text();
  const sitemapUrls = [...idxXml.matchAll(/<loc>(https:\/\/marktenmeer\.nl\/mm_markt-sitemap\d*\.xml)<\/loc>/g)].map(m => m[1]);
  console.log(`[marktenmeer.nl] ${sitemapUrls.length} mm_markt sitemaps gevonden`);

  const matchingUrls = [];
  for (const smUrl of sitemapUrls) {
    const smRes = await fetch(smUrl, { headers: { "User-Agent": BROWSER_USER_AGENT } });
    if (!smRes.ok) continue;
    const smXml = await smRes.text();
    const pageUrls = [...smXml.matchAll(/<loc>(https:\/\/marktenmeer\.nl\/markt\/[^<]+)<\/loc>/g)].map(m => m[1]);

    for (const pageUrl of pageUrls) {
      const slug = pageUrl.split("/markt/")[1] || "";
      const eventDate = parseDateFromSlug(slug);
      if (eventDate && eventDate >= start && eventDate <= end) {
        matchingUrls.push(pageUrl);
      }
    }
  }
  console.log(`[marktenmeer.nl] ${matchingUrls.length} events binnen datumvenster`);
  return matchingUrls;
}

async function fetchMarktenmeerJsonLd(url) {
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "text/html" } });
  if (!res.ok) return null;
  const html = await res.text();
  const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (!jsonLdMatch) return null;

  for (const block of jsonLdMatch) {
    const jsonStr = block.replace(/<\/?script[^>]*>/gi, "");
    try {
      const data = JSON.parse(jsonStr);
      if (data["@type"] === "Event") return data;
    } catch { /* skip */ }
  }
  return null;
}

async function fetchMarktenmeer(startDate, endDate) {
  const urls = await fetchMarktenmeerSitemapUrls(startDate, endDate);
  const items = [];
  let fetched = 0;

  for (const url of urls) {
    const event = await fetchMarktenmeerJsonLd(url);
    fetched++;
    if (!event) continue;

    const location = event.location || {};
    const address = location.address || {};
    const venueKey = [location.name, address.addressLocality].filter(Boolean).join(", ") || "Nederland";

    items.push({
      id: `mm-${url.split("/markt/")[1]?.replace(/\/$/, "") || fetched}`,
      title: decodeHtmlEntities(event.name || "Markt"),
      category: guessCategory(event.name || "", event.description || ""),
      venueKey,
      date: event.startDate || null,
      source: "marktenmeer.nl",
      url
    });

    if (fetched % 10 === 0) await sleep(500); // beleefd tempo
  }
  console.log(`[marktenmeer.nl] ${items.length}/${fetched} pagina's leverden events op`);
  return items;
}

// --- Bron: marbo.nl (HTML-boekingstabel) ---
async function fetchMarboMarkten() {
  const res = await fetch(MARBO_URL, { headers: { "User-Agent": BROWSER_USER_AGENT } });
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
  const res = await fetch(url, { headers: { "User-Agent": BOT_USER_AGENT } });
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
  items = items.concat(await fetchMarktenmeer(startDate, endDate));
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
