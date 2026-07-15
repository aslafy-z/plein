# Plein. — le plein au juste prix

Application web (mobile-first, responsive desktop) pour trouver les stations-service
les moins chères **autour de vous** et **le long de vos trajets**, en France.

Implémentation du prototype Claude Design « Plein - Prototype » (voir `project/` et `chats/`).

## Lancer

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build (dist/)
npm run verify       # E2E : parcourt tous les écrans + screenshots (nécessite le dev server)
npm run verify:live  # vérifie les providers réels (gouv/BAN/OSRM) contre les vrais endpoints
```

## Écrans

Onboarding → **Carte** (pins de prix Leaflet, meilleure station en bottom-sheet,
déplacement de la carte = chargement automatique des stations de la zone,
bouton de recentrage) →
**Liste** (économie possible, tri prix/distance) → **Trajet** (départ « Ma position »,
autocomplétion, carte du trajet avec pins des stations du corridor + limite d'autonomie,
ruban vertical avec arrêt conseillé selon 3 stratégies) →
**Fiche station** (mini-carte, adresse, statut d'ouverture réel) →
**Filtres** (carburant, rayon, marques, services) → **Réglages**.

- Le **statut d'ouverture** (« Ouvert 24/24 », « Fermé · ouvre à 6 h 30 »…) vient des
  horaires réels du flux gouvernemental ; quand la source ne les fournit pas, l'app
  n'affiche rien plutôt que de prétendre « ouvert ».
- Les **Récents** du Trajet sont l'historique réel des trajets calculés (distance +
  date persistées) ; tant qu'il est vide, des suggestions neutres s'affichent.

Action principale partout : **Y aller** — `geo:` sur Android (choix de
l'app GPS installée), Plans sur iOS, Google Maps sur desktop ; la tournée
multi-arrêts (« Lancer la tournée ») passe par Google Maps (seule URL multi-étapes).
La « tournée » multi-arrêts est secondaire (petit « + » sur chaque arrêt).

## Sources de données — architecture pluggable

Tout passe par trois interfaces (`src/data/types.ts`) :

| Interface          | Réel (défaut)                                            | Démo (hors-ligne)              |
| ------------------ | -------------------------------------------------------- | ------------------------------ |
| `StationsProvider` | data.economie.gouv.fr — flux instantané v2 (ODS Explore) | jeu fictif Toulouse + corridors |
| `GeocodeProvider`  | api-adresse.data.gouv.fr (BAN)                           | dictionnaire de villes         |
| `RouteProvider`    | router.project-osrm.org (OSRM démo)                      | interpolation grande-cercle    |

- Sélection dans **Réglages → Données** (persistée en localStorage).
- **Cache stale-while-revalidate** (`src/data/stationsCache.ts`) : les dernières
  zones cherchées sont conservées en localStorage ; l'app affiche le cache
  instantanément et rafraîchit en arrière-plan (flèche qui tourne pendant la
  mise à jour, pictogramme horloge ambre quand les prix affichés datent de
  plus de 10 min — p. ex. hors-ligne). La **dernière position** est également
  persistée : au rechargement, l'app repart de là (cache instantané, pas de
  flash Toulouse/démo en attendant la géolocalisation).
- **PWA installable** : manifest + service worker minimal (`public/sw.js`,
  assets en cache-first, navigation en network-first) ; l'app capte
  `beforeinstallprompt` et propose le dialogue d'installation natif Android
  (bannière sur la carte + entrée dans Réglages → Application).
- Si la source réelle échoue sans cache disponible, bascule automatique sur la
  démo avec bannière visible ; avec cache, les prix en cache restent affichés.
- Le flux gouvernemental ne fournit **ni enseigne ni nom de station** : les providers
  déclarent `capabilities.brands` et l'UI s'adapte (le filtre « Marques » n'apparaît
  que si la source connaît les enseignes). Il fournit en revanche les **horaires**
  (parsés vers `Station.hours`, statut calculé dans `src/lib/hours.ts`).
- La recherche le long d'un trajet interroge des cercles qui **couvrent tout le
  corridor** (rayon = ½ espacement des échantillons + corridor), puis filtre par
  distance réelle à la polyline — `npm run verify:live` vérifie que les stations
  s'étalent sur toute la longueur du trajet.

Pour ajouter une source : implémenter les interfaces et l'enregistrer dans
`src/data/providers.ts`.

### Environnements sans accès internet direct (sandboxes, proxys)

En dev, les appels APIs passent par `/proxy/*` et les tuiles de secours par
`/tiles/*`, servis par le dev server Vite (voir `vite.config.ts`), qui respecte
`HTTPS_PROXY`. Les tuiles CARTO sombres restent la source principale ; si le CDN
est injoignable depuis le navigateur, la carte bascule automatiquement sur des
tuiles OpenStreetMap proxifiées et assombries en CSS (`.tiles-dark`). En build
de production, les URLs directes sont utilisées.

## Stack

Vite · React 18 · TypeScript strict · Leaflet (tuiles CARTO dark) · aucune autre dépendance.
State: contexte React unique (`src/state/store.tsx`) + sélecteurs purs partagés par
tous les écrans (une seule définition de « station visible », « moins chère », etc.).
