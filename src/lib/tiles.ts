// Dark basemap with automatic fallback.
// Primary: CARTO dark CDN, re-toned to the app palette via `.tiles-carto`.
// When it can't load (offline CDN, firewalled network), the map swaps to
// OpenStreetMap tiles (through the dev-server proxy in dev), darkened with
// the `.tiles-dark` CSS filter so the app keeps its look. The first map that
// discovers the CDN is unreachable remembers it for the session, so the map,
// route and station views all switch together.
import L from 'leaflet';
import { IS_DEV } from './env';

const CARTO_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const FALLBACK_URL = IS_DEV ? '/tiles/{z}/{x}/{y}.png' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** No CARTO tile managed to load within this window → assume unreachable */
const GIVE_UP_MS = 6000;

let cartoUnreachable = false;

function addFallback(map: L.Map): void {
  L.tileLayer(FALLBACK_URL, {
    attribution: '© OpenStreetMap · © CARTO',
    maxZoom: 19,
    // The dev proxy serves CARTO (already dark); the prod fallback is raw OSM
    // and needs the darkening filter.
    className: IS_DEV ? 'tiles-carto' : 'tiles-dark',
  }).addTo(map);
}

export function addDarkBasemap(map: L.Map): void {
  if (cartoUnreachable) {
    addFallback(map);
    return;
  }

  const carto = L.tileLayer(CARTO_URL, {
    attribution: '© OpenStreetMap · © CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
    className: 'tiles-carto',
  });

  let loaded = 0;
  let errored = 0;
  let swapped = false;

  const swap = () => {
    if (swapped) return;
    swapped = true;
    cartoUnreachable = true;
    map.removeLayer(carto);
    addFallback(map);
  };

  // Zoom changes abort pending tiles without firing tileerror, so a count
  // alone can miss the failure — the timer catches that case.
  const giveUp = setTimeout(() => {
    if (loaded === 0) swap();
  }, GIVE_UP_MS);

  carto.on('tileload', () => {
    loaded++;
    clearTimeout(giveUp);
  });
  carto.on('tileerror', () => {
    errored++;
    if (loaded === 0 && errored >= 2) swap();
  });
  map.on('unload', () => clearTimeout(giveUp));

  carto.addTo(map);
}
