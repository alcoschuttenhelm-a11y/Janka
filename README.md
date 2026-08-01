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

## Databronnen

Er bestaat geen centrale Nederlandse API die markten, braderieën én kermis/feesten met
datum landelijk dekt. Daarom combineert de app meerdere CORS-vriendelijke bronnen:

| Bron | Dekking | Wat het levert | Sleutel nodig? |
|---|---|---|---|
| **OpenStreetMap Overpass API** | Wereldwijd | Vaste weekmarkt-locaties (`amenity=marketplace`) | Nee |
| **Wikidata** | Wereldwijd (wisselend compleet) | Aanvullende marktlocaties | Nee |
| **Gemeente Amsterdam open data** | Alleen Amsterdam | Officiële weekmarkten met dagen | Nee |
| **UiTdatabank (publiq)** | België (Vlaanderen/Brussel) | Actuele evenementen mét datum: markten, kermis, braderie, festivals | **Ja, gratis** |

### Bekende beperking: Nederlandse feesten/kermis/braderieën

Voor het specifieke "feesten/kermis/braderie"-segment in **Nederland** bestaat geen
CORS-vriendelijke API of feed (onderzocht: kermis.nu, wattedoenin.nl, dagjeweg.nl e.d. —
alleen HTML-pagina's, geen API). Deze app gebruikt daarom bewust **geen scraping**, in lijn
met de keuze om zonder eigen server/proxy te werken en scraping-grijs-gebied te vermijden.
Praktisch gevolg: in Nederland toont de app vooral **vaste weekmarkten** (OSM/Wikidata/
Amsterdam), nog geen eenmalige NL-braderieën/kermissen met datum. Voor België (en dus ook
tijdens een vakantie daar) werkt dit wél volledig via UiTdatabank.

**Als je dit later alsnog wilt uitbreiden:** een lichte, gratis CORS-proxy (bv. een
Cloudflare Worker) zou de NL-kermis/braderie-sites kunnen ontsluiten. Overleg dit gerust
opnieuw — dit is bewust nu niet gebouwd omdat je koos voor de optie zonder scraping.

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

## Instellingen

- **Zoekstraal:** 1–50 km, standaard 10 km.
- **Dagen vooruit:** 1–14 dagen, standaard 7 (heeft alleen effect op bronnen met datums,
  d.w.z. UiTdatabank — vaste marktlocaties hebben geen datum).
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
