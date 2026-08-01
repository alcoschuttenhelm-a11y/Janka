# Janka's Appie

Progressive Web App (PWA) die markten, braderieën en (kermis)feesten in de buurt toont —
thuis in Nederland én op vakantie, op basis van je GPS-locatie. Draait volledig
client-side: geen eigen backend-server, geen scraping-infrastructuur om te onderhouden.

## Architectuur

- **Type:** Progressive Web App — installeerbaar op Android via de browser ("Toevoegen aan
  startscherm"), geen Play Store nodig.
- **Geen backend.** Alle data wordt rechtstreeks vanuit de browser opgehaald bij bronnen die
  CORS toestaan. Er draait geen server die scraped, plant of doorstuurt.
- **Bestanden:**
  - `index.html` — app-shell (lijst-tab, kaart-tab, instellingen)
  - `css/style.css` — vormgeving (licht/donker)
  - `js/datasources.js` — ophalen + normaliseren van externe data
  - `js/map.js` — Leaflet-kaartweergave (OpenStreetMap-tegels)
  - `js/notifications.js` — meldingen + service worker registratie
  - `js/app.js` — geolocation, instellingen, rendering
  - `service-worker.js` — offline app-shell caching + best-effort achtergrondsync
  - `manifest.json` — PWA-manifest (naam, iconen, kleuren)
  - `icons/` — app-iconen (192px, 512px)
  - `data/nl-markten.json` — dagelijks ververst door GitHub Actions, zie hieronder
  - `scripts/fetch-nl-markten.js` + `scripts/geocode-cache.json` — het ophaal-/geocode-script
  - `.github/workflows/update-nl-markten.yml` — de dagelijkse GitHub Actions-workflow
  - `cf-worker/` — de Cloudflare Worker-proxy voor wattedoenin.nl (België/NL feesten)

## Databronnen

Er bestaat geen centrale Nederlandse API die markten, braderieën én kermis/feesten met
datum landelijk dekt. Daarom combineert de app meerdere CORS-vriendelijke bronnen:

| Bron | Dekking | Wat het levert | Sleutel nodig? |
|---|---|---|---|
| **OpenStreetMap Overpass API** | Wereldwijd | Vaste weekmarkt-locaties (`amenity=marketplace`) | Nee |
| **Wikidata** | Wereldwijd (wisselend compleet) | Aanvullende marktlocaties | Nee |
| **Gemeente Amsterdam open data** | Alleen Amsterdam | Officiële weekmarkten met dagen | Nee |
| **UiTdatabank (publiq)** | België (Vlaanderen/Brussel) | Actuele evenementen mét datum: markten, kermis, braderie, festivals | **Ja, gratis** |
| **NL feesten-proxy (eigen Cloudflare Worker)** | Nederland | Jaarmarkten/braderieën met datum, via wattedoenin.nl | **Ja** (Worker-URL invullen, zie hieronder) |
| **NL markten (dagelijks bestand)** | Nederland | Markten/braderieën/jaarmarkten met datum, via marktenmeer.nl, evenementenlijst.nl, wildro.nl en marbo.nl | Nee (staat al klaar) |

### Nederlandse feesten/kermis/braderieën

Voor dit segment bestaat geen kant-en-klare CORS-vriendelijke API. Onderzocht: kermis.nu
(profileert zichzelf expliciet als niet-geautomatiseerde, handmatig gecureerde site — bewust
overgeslagen) en wattedoenin.nl (publiceert evenementen wél in gestandaardiseerde
`schema.org/Event`-microdata, hetzelfde format dat zoekmachines gebruiken, met een
robots.txt die algemene bots toestaat op deze pagina's). Om deze laatste bron client-side
bruikbaar te maken — browsers staan geen cross-origin scraping toe — is er een kleine,
losstaande Cloudflare Worker gebouwd die de data ontsluit als CORS-vriendelijke JSON-API.
Zie [`cf-worker/README.md`](cf-worker/README.md) om deze (gratis) te deployen. De app heeft
`https://janka-appie-nl-feesten.mailvanakkie.workers.dev` al standaard ingevuld bij
**Instellingen → "NL feesten-proxy URL"** — pas dit alleen aan als je je eigen Worker onder
een andere naam/account deployt. Zonder een geldige URL hier toont de app voor Nederland
alleen vaste weekmarkten (OSM/Wikidata/Amsterdam); met UiTdatabank werkt
evenementen-met-datum al voor België.

## NL markten: dagelijks ververst bestand (GitHub Actions)

Voor marktenmeer.nl, evenementenlijst.nl, wildro.nl en marbo.nl bestaat geen CORS-vriendelijke
live API — maar in tegenstelling tot wattedoenin.nl (waar een Cloudflare Worker als proxy
nodig was) lost deze bron het anders op: **een GitHub Actions-workflow haalt deze 4 bronnen
1x per dag server-side op** (daar bestaat geen CORS-beperking), voegt ze samen, geocodeert
ontbrekende coördinaten (via PDOK Locatieserver) en schrijft het resultaat weg als
[`data/nl-markten.json`](data/nl-markten.json) — gewoon een statisch bestand naast de app op
GitHub Pages. De app haalt dit bestand simpelweg op zoals elk ander bestand, geen Worker of
sleutel nodig.

- **Script:** [`scripts/fetch-nl-markten.js`](scripts/fetch-nl-markten.js) (Node.js, geen
  externe packages nodig — gebruikt de ingebouwde `fetch`).
- **Workflow:** [`.github/workflows/update-nl-markten.yml`](.github/workflows/update-nl-markten.yml),
  draait dagelijks om 03:00 UTC en is ook handmatig te starten via de **Actions**-tab van de
  GitHub-repository ("Run workflow").
- **Geocode-cache:** [`scripts/geocode-cache.json`](scripts/geocode-cache.json) — voorkomt dat
  elke dag alle locaties opnieuw geocodeerd worden; alleen nieuwe locaties worden aangevraagd
  bij PDOK.
- **marktenmeer.nl, evenementenlijst.nl, wildro.nl** draaien op dezelfde WordPress-plugin
  ("The Events Calendar") met een officiële REST API
  (`/wp-json/tribe/events/v1/events`) — geen HTML-scraping. **marbo.nl** is een
  kraamverhuur-boekingspagina met een eenvoudige, stabiele HTML-tabel; deze wordt met een
  gerichte regex geparsed (geen generieke scraper).
- **Let op (marbo.nl):** de bron-URL bevat het jaartal (`marbo.nl/markten-2026/`) — dit moet
  jaarlijks handmatig bijgewerkt worden in `scripts/fetch-nl-markten.js` zodra marbo.nl een
  nieuwe jaarpagina publiceert.
- **Nieuwe bron toevoegen die ook op "The Events Calendar" draait?** Voeg het domein toe aan
  `EVENTS_CALENDAR_SITES` in het script — verder is er geen nieuwe code nodig.

## UiTdatabank API-sleutel aanvragen

1. Ga naar https://docs.publiq.be en registreer een gratis account/consumer.
2. Kopieer je API-sleutel.
3. Open in de app **Instellingen (tandwiel-icoon)** → plak de sleutel bij
   "UiTdatabank API-sleutel" → sluit het scherm (dit ververst automatisch).

De sleutel wordt alleen lokaal in de browser (localStorage) opgeslagen, nooit verstuurd
naar een server van ons.

> **Let op:** de exacte querystructuur van de UiTdatabank Search API (geo-filter,
> datumfilter) is geïmplementeerd op basis van de publieke documentatie-structuur, maar kon
> niet live getest worden zonder een geldige sleutel. Werkt de bron niet na het invullen van
> je sleutel? Controleer de actuele parameters op https://docs.publiq.be en pas
> `js/datasources.js` (functie `fetchUitdatabankEvents`) zo nodig aan.

## Installeren op je Android-telefoon

1. Publiceer de app (zie hieronder: GitHub Pages).
2. Open de gepubliceerde HTTPS-link in Chrome op je Android-telefoon.
3. Tik op het menu (⋮) → **"Toevoegen aan startscherm"** / **"App installeren"**.
4. Geef locatietoegang wanneer daarom gevraagd wordt.
5. Optioneel: schakel meldingen in via het instellingen-scherm in de app.

## Publiceren via GitHub Pages

1. Maak een nieuwe (publieke) GitHub-repository aan, bijvoorbeeld `jankas-appie`.
2. Push de inhoud van deze map (`C:\CLpowershell\JankasAppie`) naar die repository.
3. Ga naar **Settings → Pages** in de repository, kies als bron de `main`-branch,
   map `/ (root)`.
4. Na een paar minuten is de app bereikbaar op
   `https://<jouw-gebruikersnaam>.github.io/jankas-appie/`.
5. Gebruik die HTTPS-link om de app op je telefoon te installeren (zie boven).

Geen serverbeheer nodig: GitHub Pages ververst automatisch bij elke nieuwe push.

## Meldingen: wat wel en niet werkt

- **Terwijl de app open is:** werkt betrouwbaar — nieuwe markten/evenementen binnen je
  zoekstraal geven direct een melding.
- **Op de achtergrond (app dicht):** alleen best-effort via de *Periodic Background Sync
  API*, en alleen in Chromium-browsers op Android, en alleen als de browser vindt dat je de
  app vaak genoeg gebruikt. Er is bewust géén eigen pushserver gebouwd (dat zou weer een
  server vereisen die iemand moet onderhouden) — dit is de afweging die hoort bij "geen
  backend, alles op de telefoon".

## "1 bron(nen) tijdelijk niet bereikbaar"

Elke bron heeft een tijdslimiet van 20 seconden — komt er binnen die tijd geen antwoord (of
een foutcode), dan wordt die ene bron overgeslagen zonder de rest te blokkeren. De
statusregel toont voortaan **welke** bron het was, bv. "(niet bereikbaar: Wikidata)". Dit is
meestal een tijdelijke hapering van een gratis publieke API (Wikidata en, bij een grote
zoekstraal, OpenStreetMap Overpass kunnen 15–20 sec. duren) — een volgende verversing lukt
doorgaans gewoon. Blijft steeds dezelfde bron structureel falen, dan is dat het vermelden
waard.

## Instellingen

- **Locatie:** standaard je GPS-locatie. Via "Locatie" in Instellingen kun je ook een
  plaatsnaam/adres opzoeken (via Nominatim/OpenStreetMap) en die handmatig instellen — handig
  om ergens anders te kijken zonder er zelf te zijn. Met "Gebruik mijn GPS-locatie" schakel je
  weer terug.
- **Zoekstraal:** 1–100 km, standaard 10 km. Let op: bij een grote straal (bv. 100 km) kan het
  laden merkbaar langer duren (10–20 sec.), omdat de OpenStreetMap-bron dan een veel groter
  gebied moet doorzoeken.
- **Dagen vooruit:** 1–14 dagen, standaard 7 (heeft alleen effect op bronnen met datums,
  d.w.z. UiTdatabank en de NL feesten-proxy — vaste marktlocaties hebben geen datum).
- **Categorieën tonen:** Markt, Evenement, Braderie en Kermis zijn elk apart aan/uit te
  zetten — bijvoorbeeld handig om vaste weekmarkten te verbergen en alleen eenmalige
  evenementen te zien.
- Instellingen worden lokaal opgeslagen (localStorage), niet gesynchroniseerd tussen
  apparaten.

## Lokaal testen (op je PC, vóór publicatie)

Deze map bevat `_devserver.js`, een minimale statische server op basis van Node.js (geen
installatie van extra pakketten nodig):

```bash
cd C:\CLpowershell\JankasAppie
node _devserver.js 8000
```

Open daarna `http://localhost:8000` in Chrome. Geolocation werkt op `localhost` ook zonder
HTTPS; installatie als PWA en service worker-registratie werken eveneens op `localhost` als
uitzondering op de HTTPS-eis.

`_devserver.js` is alleen bedoeld voor lokaal testen — hoeft niet mee gepubliceerd te worden
naar GitHub Pages (kan geen kwaad als het toch meegaat, het wordt daar gewoon niet gebruikt).
