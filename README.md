<div align="center">

<img src="public/icons/icon.svg" width="96" alt="Plein. logo" />

# Plein.

**A full tank at the right price** — find the cheapest fuel stations around
you and along your routes, in France, Spain, Andorra and Portugal.

**English** · [Français](README.fr.md) · [Español](README.es.md) · [Català](README.ca.md) · [Português](README.pt.md)

[![Open the app](https://img.shields.io/badge/%E2%96%B6%EF%B8%8E%20Open%20the%20app-plein.zadkiel.fr-3ddc84?style=for-the-badge&labelColor=0f1a14)](https://plein.zadkiel.fr)

[![MIT license](https://img.shields.io/badge/license-MIT-3ddc84?labelColor=0f1a14)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-installable-3ddc84?labelColor=0f1a14)](#-usage)
[![Data](https://img.shields.io/badge/data-%F0%9F%87%AB%F0%9F%87%B7%20France%20%C2%B7%20%F0%9F%87%AA%F0%9F%87%B8%20Spain%20%C2%B7%20%F0%9F%87%A6%F0%9F%87%A9%20Andorra%20%C2%B7%20%F0%9F%87%B5%F0%9F%87%B9%20Portugal-blue?labelColor=0f1a14)](#-data-sources)
[![React 18](https://img.shields.io/badge/React-18-61dafb?labelColor=0f1a14&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?labelColor=0f1a14&logo=typescript)](https://www.typescriptlang.org)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?labelColor=0f1a14)](https://leafletjs.com)

<br/>

| Prices around you | A station's page | Along your route |
| :---: | :---: | :---: |
| <img src="docs/screenshots/en/map.png" width="250" alt="Price map around Toulouse" /> | <img src="docs/screenshots/en/station.png" width="250" alt="A station's page: price per fuel, gap to the cheapest, services and savings on a full tank" /> | <img src="docs/screenshots/en/route.png" width="250" alt="Station comparison on a Toulouse → Lille route" /> |

</div>

## ✨ Features

- 🗺️ **Live price map** — stations around you, price pins colored by price:
  good deals in green, the priciest in orange.
- 🇫🇷🇪🇸🇦🇩🇵🇹 **Four countries on one map** — the official feeds of France,
  Spain, Andorra and Portugal combined; border fill-ups compare at a glance.
- 📋 **Real best choice** — the fuel burned for the detour is counted, so a
  closer station can beat the cheapest one.
- 🛣️ **Route fuel plan** — where to stop along your trip, how many liters at
  each stop and at what cost, under 3 strategies.
- ⭐ **Favorites** — your stations and their day's price, across areas and
  countries.
- ⛽ **All fuels** — Diesel, SP95/98, E10, E85, LPG; filters by radius,
  brands, services and AdBlue.
- 🕐 **Real opening hours** — "Open 24/7", "Closed · opens at 6:30 am" — with
  price freshness flagged.
- 🏷️ **Recognized brands** — station names and logos from the official feeds
  and OpenStreetMap.
- 🧭 **Directions** — opens the station in your GPS app.
- 🔗 **Shareable links** — the URL follows the map and the route; a link
  reopens the same view.
- 🌗 **Light and dark themes** — follows your browser, switchable in Settings.
- 🌍 **Five languages** — French, English, Spanish, Catalan and Portuguese.
- 🖥️ **Phone and desktop** — full-screen map and sheet on mobile, side panels
  on a wide screen.
- 📱 **Installable PWA** — the last areas and tiles work offline.

## 🚀 Usage

1. Open **[plein.zadkiel.fr](https://plein.zadkiel.fr)** (the official deployment).
2. Allow geolocation — or continue without it, and search for a city in
   France, Spain, Andorra or Portugal. The search remembers the places you
   picked there: it offers them as soon as it opens and ranks them at the top
   of the suggestions as soon as you type.
3. Pick your fuel at the top of the map: the best choice (price AND distance,
   detour counted) shows up in the bottom sheet, **Directions** starts the
   guidance.
4. Before a long trip, open the **Route** tab: enter the destination and
   compare the stations along the way.
5. On mobile, install the app (install banner or *Settings → Application*) to
   get it as an icon, full screen and offline.

No account, no tracker: your favorites and settings stay in your browser.

## 📊 Data sources

Each covered country has its own official feeds — prices and geocoding —
which the app picks according to the visible area (*Automatic* source). The
rest (routing, basemaps) is shared by all four.

### 🇫🇷 France

| Data | Source | License |
| --- | --- | --- |
| Fuel prices & opening hours | [Prix des carburants — real-time feed](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) (data.economie.gouv.fr) | Licence Ouverte / Open Licence |
| Station brands | [OpenStreetMap](https://www.openstreetmap.org/) (generated static index, matched to stations by proximity) | ODbL |
| Geocoding & autocompletion | [Base Adresse Nationale](https://adresse.data.gouv.fr/) (api-adresse.data.gouv.fr) | Licence Ouverte / Open Licence |

### 🇪🇸 Spain

| Data | Source | License |
| --- | --- | --- |
| Fuel prices, hours & brands | [Precios de carburantes](https://geoportalgasolineras.es) (sedeaplicaciones.minetur.gob.es, MITECO) — the brand (*rótulo*) is carried by the feed | Datos abiertos |
| Geocoding & autocompletion | [CartoCiudad](https://www.cartociudad.es) (IGN) | CC BY 4.0 |

### 🇦🇩 Andorra

| Data | Source | License |
| --- | --- | --- |
| Fuel prices & brands | [Preus dels carburants](https://sig.govern.ad/IPE/PreusCarburants) (sig.govern.ad, Govern d'Andorra — Oficina de l'Energia i del Canvi Climàtic) — the brand is derived from the station name; the feed carries neither address nor opening hours | © Govern d'Andorra |
| Geocoding & autocompletion | Nomenclàtor (official gazetteer) & LocatorIDE (sig.govern.ad, IDE Andorra) | © Govern d'Andorra |

### 🇵🇹 Portugal

| Data | Source | License |
| --- | --- | --- |
| Fuel prices & brands | [Preços dos combustíveis](https://precoscombustiveis.dgeg.gov.pt) (DGEG — Direção-Geral de Energia e Geologia) — the brand (*marca*) is carried by the feed, which gives neither opening hours nor E10; mainland coverage (the Azores and Madeira have their own regime) | Dados abertos |
| Geocoding & autocompletion | [Photon](https://photon.komoot.io) (public Komoot instance, OpenStreetMap index), bounded to mainland Portugal — the country publishes no keyless address geocoder | ODbL |

### Shared by all four countries

| Data | Source | License |
| --- | --- | --- |
| Routing | [OSRM](https://project-osrm.org/) (demo server) · [Valhalla](https://valhalla.github.io/valhalla/) (public FOSSGIS server) for "avoid motorways / tolls" | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors |
| Basemaps | [CARTO](https://carto.com/attributions) light / dark following the theme (OpenStreetMap tiles as offline-friendly fallback) | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors |

The app has **no backend**: the browser queries these public services
directly. Sources are pluggable (`src/data/types.ts`). Offline or when a feed
is down, the app keeps the last loaded stations (per-area cache) with an
explicit banner and retries as soon as the connection returns; the offline
demo dataset serves development and the test suite only and is never offered
in the app.

## 🛠️ Development

Stack: **Vite · React 18 · strict TypeScript · Leaflet**, no other runtime
dependency. Deployed on Cloudflare Workers (`wrangler`).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build (dist/)
npm run e2e          # Playwright E2E: walks through every screen
npm run verify:live  # checks the real providers (France, Spain, Andorra, Portugal, geocoders, OSRM) against the live endpoints
npm run deploy       # build + wrangler deploy
```

To add a data source: implement the `StationsProvider` / `GeocodeProvider` /
`RouteProvider` interfaces and register it in `src/data/providers.ts`.

In an environment without direct internet access (sandbox, corporate proxy),
the Vite dev server proxies the APIs (`/proxy/*`) and the tiles (`/tiles/*`)
honoring `HTTPS_PROXY` — see `vite.config.ts`.

## 📄 License

Code under the [MIT](LICENSE) license © Zadkiel Aharonian.
The displayed data remains subject to the licenses of its respective
producers (Licence Ouverte for French public data, MITECO datos abiertos for
Spanish prices, © Govern d'Andorra for Andorra, DGEG dados abertos for
Portuguese prices, ODbL for OpenStreetMap).
The **Archivo** and **Spline Sans Mono** fonts, embedded in `public/fonts/`,
are under the [SIL Open Font License 1.1](public/fonts/) (see the `*-OFL.txt`
files in the same folder).
