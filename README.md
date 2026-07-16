<div align="center">

<img src="public/icons/icon.svg" width="96" alt="Logo Plein." />

# Plein.

**Le plein au juste prix** — trouvez les stations-service les moins chères
autour de vous et le long de vos trajets, partout en France.

[![Ouvrir l'app](https://img.shields.io/badge/%E2%96%B6%EF%B8%8E%20Ouvrir%20l'app-plein.zadkiel.fr-3ddc84?style=for-the-badge&labelColor=0f1a14)](https://plein.zadkiel.fr)

[![Licence MIT](https://img.shields.io/badge/licence-MIT-3ddc84?labelColor=0f1a14)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-installable-3ddc84?labelColor=0f1a14)](#-utilisation)
[![Données](https://img.shields.io/badge/donn%C3%A9es-data.gouv.fr-blue?labelColor=0f1a14)](#-sources-de-données)
[![React 18](https://img.shields.io/badge/React-18-61dafb?labelColor=0f1a14&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?labelColor=0f1a14&logo=typescript)](https://www.typescriptlang.org)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?labelColor=0f1a14)](https://leafletjs.com)

<br/>

| Les prix autour de vous *(Toulouse)* | Sur votre trajet *(Toulouse → Nantes)* |
| :---: | :---: |
| <img src="docs/screenshots/carte.png" width="300" alt="Carte des prix autour de Toulouse" /> | <img src="docs/screenshots/trajet.png" width="300" alt="Comparaison des stations sur un trajet Toulouse → Nantes" /> |

</div>

## ✨ Fonctionnalités

- 🗺️ **Carte des prix en direct** — les stations autour de vous avec leur prix en
  pin, la moins chère mise en avant ; déplacez la carte, les stations de la zone
  se chargent automatiquement.
- 📋 **Liste de la zone** — tirez le volet du bas : toutes les stations visibles,
  triables par prix ou distance, synchronisées avec la carte.
- 🛣️ **Comparateur de trajet** — départ « Ma position » ou n'importe quelle
  adresse, autocomplétion, carte du corridor et **arrêt conseillé** selon
  3 stratégies (meilleur compromis · prix le plus bas · détour minimal), avec
  limite d'autonomie du réservoir et coût carburant estimé du trajet.
- ⭐ **Favoris** — épinglez vos stations, retrouvez leur prix du jour d'un coup d'œil.
- ⛽ **Tous les carburants** — Gazole, SP95/98, E10, E85, GPLc ; filtres par
  rayon, enseignes et services.
- 🕐 **Horaires réels** — « Ouvert 24/24 », « Fermé · ouvre à 6 h 30 »… calculés
  depuis les horaires officiels ; fraîcheur des prix affichée (et signalée quand
  ils datent).
- 🏷️ **Enseignes reconnues** — logos et noms des stations (TotalEnergies,
  E.Leclerc, Intermarché…) appariés depuis OpenStreetMap.
- 🧭 **« Y aller »** — ouvre votre app GPS : choix de l'app sur Android (`geo:`),
  Plans sur iOS, Google Maps sur desktop ; tournée multi-arrêts possible.
- 📱 **PWA installable et tolérante au hors-ligne** — ajoutez-la à l'écran
  d'accueil ; les dernières zones consultées et les tuiles de carte restent
  disponibles sans réseau, avec indicateur d'ancienneté des prix.

## 🚀 Utilisation

1. Ouvrez **[plein.zadkiel.fr](https://plein.zadkiel.fr)** (le déploiement officiel).
2. Autorisez la géolocalisation — ou continuez sans, et cherchez une ville.
3. Choisissez votre carburant en haut de la carte : la station la moins chère
   apparaît dans le volet du bas, **Y aller** lance le guidage.
4. Avant de partir loin, onglet **Trajet** : saisissez la destination et
   comparez les stations le long du parcours.
5. Sur mobile, installez l'app (bannière d'installation ou
   *Réglages → Application*) pour l'avoir en icône, plein écran et hors-ligne.

Aucun compte, aucun tracker : vos favoris et réglages restent dans votre navigateur.

## 📊 Sources de données

| Donnée | Source | Licence |
| --- | --- | --- |
| Prix des carburants & horaires | [Prix des carburants — flux temps réel](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) (data.economie.gouv.fr) | Licence Ouverte / Open Licence |
| Géocodage & autocomplétion | [Base Adresse Nationale](https://adresse.data.gouv.fr/) (api-adresse.data.gouv.fr) | Licence Ouverte / Open Licence |
| Calcul d'itinéraires | [OSRM](https://project-osrm.org/) (serveur démo) | Données © OpenStreetMap |
| Enseignes des stations | [OpenStreetMap](https://www.openstreetmap.org/) (index statique généré) | ODbL |
| Fonds de carte | [OSM France](https://www.openstreetmap.fr/fonds-de-carte/) (libellés en français) · données © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) | — |

L'app n'a **aucun backend** : le navigateur interroge directement ces services
publics. Les sources sont pluggables (`src/data/types.ts`) — un jeu de données
de démonstration hors-ligne prend automatiquement le relais si le flux réel est
indisponible, avec bannière explicite.

## 🛠️ Développement

Stack : **Vite · React 18 · TypeScript strict · Leaflet**, sans autre dépendance
runtime. Déployé sur Cloudflare Workers (`wrangler`).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # build de production (dist/)
npm run e2e          # E2E Playwright : parcourt tous les écrans
npm run verify:live  # vérifie les providers réels (gouv/BAN/OSRM) contre les vrais endpoints
npm run deploy       # build + wrangler deploy
```

Pour ajouter une source de données : implémenter les interfaces
`StationsProvider` / `GeocodeProvider` / `RouteProvider` et l'enregistrer dans
`src/data/providers.ts`.

En environnement sans accès internet direct (sandbox, proxy d'entreprise), le
dev server Vite proxifie les APIs (`/proxy/*`) et les tuiles (`/tiles/*`) en
respectant `HTTPS_PROXY` — voir `vite.config.ts`.

## 📄 Licence

Code sous licence [MIT](LICENSE) © Zadkiel Aharonian.
Les données affichées restent soumises aux licences de leurs producteurs
respectifs (Licence Ouverte pour les données publiques françaises, ODbL pour
OpenStreetMap).
