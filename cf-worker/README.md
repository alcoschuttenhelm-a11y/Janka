# NL feesten-proxy (Cloudflare Worker)

Ontsluit Nederlandse jaarmarkten/braderieën (met datum, locatie en coördinaten) als
CORS-vriendelijke JSON-API, zodat Janka's Appie deze kan tonen zonder dat de PWA zelf
hoeft te scrapen. Bron: [wattedoenin.nl/jaarmarkten-braderieen](https://www.wattedoenin.nl/jaarmarkten-braderieen/),
die haar evenementen publiceert in gestandaardiseerde `schema.org/Event`-microdata.

Lokaal getest (via `wrangler dev`): geeft correcte resultaten terug, inclusief voor Tiel
(50 km, 14 dagen → "Huissense Dag" en "de Loense Moandag" gevonden).

## Kosten

Gratis Cloudflare-account, Workers Free-tier (100.000 requests/dag) is ruim voldoende voor
persoonlijk gebruik. Geen creditcard vereist voor de Free-tier van Workers.

## Deployen (geen command line nodig — via de Cloudflare-dashboard)

1. Maak een gratis account op https://dash.cloudflare.com/sign-up (of log in als je er al
   een hebt).
2. Ga naar **Workers & Pages → Create → Create Worker**.
3. Geef de Worker een naam, bijvoorbeeld `jankas-appie-nl-feesten`, en klik **Deploy** (de
   standaard "Hello World"-code is prima als startpunt).
4. Klik op **Edit code** (opent de online code-editor).
5. Verwijder de standaardcode en plak de volledige inhoud van [`worker.js`](worker.js) uit
   deze map.
6. Klik **Save and deploy**.
7. Je krijgt een URL zoals `https://jankas-appie-nl-feesten.<jouw-account>.workers.dev` —
   dit is de proxy-URL.

## Koppelen aan de app

1. Open Janka's Appie → **Instellingen (tandwiel)**.
2. Plak de Worker-URL (zonder `/events` erachter, bv.
   `https://jankas-appie-nl-feesten.<jouw-account>.workers.dev`) bij **"NL feesten-proxy
   URL"**.
3. Sluit het scherm — de app ververst automatisch en toont nu ook Nederlandse
   jaarmarkten/braderieën naast de vaste weekmarkten.

## Alternatief: deployen via de command line (wrangler)

Voor wie liever met een terminal werkt:

```bash
cd cf-worker
npx wrangler login    # eenmalig, opent een browserlogin naar je Cloudflare-account
npx wrangler deploy
```

`wrangler deploy` print de resulterende `workers.dev`-URL na afloop.

## Onderhoud en beperkingen

- **Caching:** de Worker cachet het resultaat van wattedoenin.nl 1 uur (Cloudflare Cache
  API), om de bronsite niet onnodig te belasten.
- **Dekking:** dit haalt op dit moment alleen de hoofdpagina op
  (`/jaarmarkten-braderieen/`), die de eerstkomende landelijke evenementen toont. Er is geen
  paginering/regio-specifieke uitbreiding gebouwd — kan later worden toegevoegd als de
  dekking te beperkt blijkt.
- **Fragiel aan site-wijzigingen:** de parsing leunt op de huidige HTML-structuur
  (schema.org/Event-microdata) van wattedoenin.nl. Als de site haar opmaak wijzigt, kan de
  proxy resultaten missen — controleer in dat geval de selectors in `worker.js`.
- **Geen garantie/overeenkomst met wattedoenin.nl:** dit is gebouwd op basis van publiek
  toegankelijke, machine-leesbare structured data en een toegestaan robots.txt-beleid, maar
  er is geen formele afspraak met de sitebeheerder. Bij twijfel of bij schaalvergroting
  (veel gebruikers) is het netjes om contact op te nemen met wattedoenin.nl.
