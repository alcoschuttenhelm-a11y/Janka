/*
 * Databronnen voor Janka's Appie.
 * Alle bronnen zijn client-side bereikbaar (CORS toegestaan) — er is geen eigen backend/proxy.
 * Elke fetch-functie geeft een array genormaliseerde items terug en faalt nooit hard:
 * bij een fout/lege respons wordt gewoon een lege array teruggegeven (zie app.js, Promise.allSettled).
 */

const DataSources = (() => {

  function toRad(deg) { return (deg * Math.PI) / 180; }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  // --- OpenStreetMap Overpass API: vaste marktlocaties (amenity=marketplace) ---
  async function fetchOsmMarkets(lat, lon, radiusKm) {
    const radiusM = Math.round(radiusKm * 1000);
    const query = `[out:json][timeout:25];(node["amenity"="marketplace"](around:${radiusM},${lat},${lon});way["amenity"="marketplace"](around:${radiusM},${lat},${lon}););out center tags;`;

    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query)
    });
    if (!res.ok) throw new Error("Overpass API fout: " + res.status);
    const data = await res.json();

    return (data.elements || []).map(el => {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (elLat == null || elLon == null) return null;
      return {
        id: "osm-" + el.type + "-" + el.id,
        title: el.tags?.name || "Weekmarkt",
        category: "markt",
        lat: elLat,
        lon: elLon,
        date: null,
        dateLabel: el.tags?.opening_hours ? "Open: " + el.tags.opening_hours : "Vaste marktlocatie",
        source: "OpenStreetMap",
        url: `https://www.openstreetmap.org/${el.type}/${el.id}`
      };
    }).filter(Boolean);
  }

  // --- Wikidata: markten in de buurt (aanvullend op OSM) ---
  async function fetchWikidataMarkets(lat, lon, radiusKm) {
    const sparql = `
      SELECT ?item ?itemLabel ?location WHERE {
        SERVICE wikibase:around {
          ?item wdt:P625 ?location .
          bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
          bd:serviceParam wikibase:radius "${radiusKm}" .
        }
        ?item wdt:P31/wdt:P279* wd:Q39035316 .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "nl,en". }
      } LIMIT 30`;

    const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql);
    const res = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
    if (!res.ok) throw new Error("Wikidata fout: " + res.status);
    const data = await res.json();

    return (data.results?.bindings || []).map(b => {
      const match = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.location?.value || "");
      if (!match) return null;
      return {
        id: "wd-" + b.item.value,
        title: b.itemLabel?.value || "Markt",
        category: "markt",
        lat: parseFloat(match[2]),
        lon: parseFloat(match[1]),
        date: null,
        dateLabel: "Vaste marktlocatie",
        source: "Wikidata",
        url: b.item.value
      };
    }).filter(Boolean);
  }

  // --- Gemeente Amsterdam open data: weekmarkten ---
  // Alleen relevant/opgehaald wanneer de gebruiker zich in de buurt van Amsterdam bevindt.
  async function fetchAmsterdamMarkets(lat, lon, radiusKm) {
    const amsterdamCenter = { lat: 52.3676, lon: 4.9041 };
    if (distanceKm(lat, lon, amsterdamCenter.lat, amsterdamCenter.lon) > 25) return [];

    const res = await fetch("https://maps.amsterdam.nl/open_geodata/geojson_lnglat.php?KAARTLAAG=MARKTEN&THEMA=markten");
    if (!res.ok) throw new Error("Amsterdam open data fout: " + res.status);
    const data = await res.json();

    return (data.features || []).map((f, i) => {
      const coords = f.geometry?.coordinates;
      if (!coords) return null;
      return {
        id: "ams-" + i,
        title: f.properties?.naam || f.properties?.NAAM || "Weekmarkt Amsterdam",
        category: "markt",
        lat: coords[1],
        lon: coords[0],
        date: null,
        dateLabel: f.properties?.dagen || f.properties?.DAGEN || "Vaste marktlocatie",
        source: "Gemeente Amsterdam",
        url: null
      };
    }).filter(Boolean);
  }

  // --- UiTdatabank (publiq): evenementen in België (markten, kermis, braderie, festivals) met datum ---
  // Vereist een gratis API-sleutel van https://docs.publiq.be, in te vullen in Instellingen.
  // LET OP: de exacte querystructuur van de UiTdatabank Search API kan wijzigen — controleer
  // https://docs.publiq.be als deze bron geen resultaten geeft, en pas zo nodig aan.
  async function fetchUitdatabankEvents(lat, lon, radiusKm, daysAhead, apiKey) {
    if (!apiKey) return [];

    const now = new Date();
    const until = new Date(now.getTime() + daysAhead * 86400000);
    const params = new URLSearchParams({
      q: "*",
      workflowStatus: "APPROVED",
      availableFrom: now.toISOString(),
      availableTo: until.toISOString(),
      geoDistance: `${lat},${lon},${radiusKm}km`,
      start: "0",
      limit: "30"
    });

    const res = await fetch("https://search.uitdatabank.be/events/?" + params.toString(), {
      headers: { "x-api-key": apiKey, Accept: "application/json" }
    });
    if (!res.ok) throw new Error("UiTdatabank fout: " + res.status);
    const data = await res.json();

    return (data.member || data["@graph"] || []).map(ev => {
      const geo = ev.location?.address ? ev.geo || ev.location?.geo : ev.geo;
      const evLat = geo?.latitude ?? ev.location?.geo?.latitude;
      const evLon = geo?.longitude ?? ev.location?.geo?.longitude;
      if (evLat == null || evLon == null) return null;
      return {
        id: "uitdb-" + (ev["@id"] || ev.id),
        title: ev.name?.nl || ev.name?.en || "Evenement",
        category: "evenement",
        lat: evLat,
        lon: evLon,
        date: ev.startDate || ev.availableFrom || null,
        dateLabel: ev.startDate ? new Date(ev.startDate).toLocaleDateString("nl-NL") : "Datum onbekend",
        source: "UiTdatabank",
        url: ev["@id"] || null
      };
    }).filter(Boolean);
  }

  // --- NL feesten/kermis/braderie-proxy (eigen Cloudflare Worker, zie cf-worker/) ---
  // Ontsluit wattedoenin.nl (schema.org/Event-data) als CORS-vriendelijke JSON-API.
  // Vereist dat de gebruiker de Worker zelf heeft gedeployed en de URL heeft ingevuld
  // bij Instellingen — zonder URL wordt deze bron overgeslagen (geen harde afhankelijkheid).
  async function fetchNlFeesten(lat, lon, radiusKm, daysAhead, proxyUrl) {
    if (!proxyUrl) return [];

    const params = new URLSearchParams({ lat, lon, radiusKm, days: daysAhead });
    const res = await fetch(proxyUrl.replace(/\/$/, "") + "/events?" + params.toString());
    if (!res.ok) throw new Error("NL feesten-proxy fout: " + res.status);
    const data = await res.json();

    return (data.events || []).map(ev => ({
      id: ev.id,
      title: ev.title,
      category: ev.category || "evenement",
      lat: ev.lat,
      lon: ev.lon,
      date: ev.startDate || null,
      dateLabel: ev.startDate ? new Date(ev.startDate).toLocaleDateString("nl-NL") : "Datum onbekend",
      source: ev.source || "wattedoenin.nl",
      url: ev.url || null
    }));
  }

  // Haalt alle bronnen parallel op; een falende bron blokkeert de andere niet.
  async function fetchAll({ lat, lon, radiusKm, daysAhead, uitdatabankKey, nlFeestenProxyUrl }) {
    const results = await Promise.allSettled([
      fetchOsmMarkets(lat, lon, radiusKm),
      fetchWikidataMarkets(lat, lon, radiusKm),
      fetchAmsterdamMarkets(lat, lon, radiusKm),
      fetchUitdatabankEvents(lat, lon, radiusKm, daysAhead, uitdatabankKey),
      fetchNlFeesten(lat, lon, radiusKm, daysAhead, nlFeestenProxyUrl)
    ]);

    const items = [];
    const errors = [];
    results.forEach(r => {
      if (r.status === "fulfilled") items.push(...r.value);
      else errors.push(r.reason?.message || String(r.reason));
    });

    // Dedupliceren op basis van naam + afgeronde locatie (OSM/Wikidata overlappen soms)
    const seen = new Set();
    const deduped = items.filter(it => {
      const key = it.title.toLowerCase() + "-" + it.lat.toFixed(3) + "-" + it.lon.toFixed(3);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.forEach(it => { it.distanceKm = distanceKm(lat, lon, it.lat, it.lon); });
    deduped.sort((a, b) => a.distanceKm - b.distanceKm);

    return { items: deduped, errors };
  }

  return { fetchAll, distanceKm };
})();
