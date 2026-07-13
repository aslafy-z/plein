// Dark basemap with automatic fallback.
// Primary: CARTO dark CDN (matches the « Cap nuit » design). When those tiles
// can't load (offline CDN, firewalled network), the map swaps to the local
// `/tiles` proxy served by the dev server from OpenStreetMap, darkened with a
// CSS filter (`.tiles-dark` in styles.css) so the app keeps its look.
import L from 'leaflet';

const CARTO_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const FALLBACK_URL = '/tiles/{z}/{x}/{y}.png';

export function addDarkBasemap(map: L.Map): void {
  const carto = L.tileLayer(CARTO_URL, {
    attribution: '© OpenStreetMap · © CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
    className: 'tiles-carto',
  });

  let loaded = 0;
  let errored = 0;
  let swapped = false;
  carto.on('tileload', () => {
    loaded++;
  });
  carto.on('tileerror', () => {
    errored++;
    // Nothing loads and several tiles failed → the CDN is unreachable
    if (swapped || loaded > 0 || errored < 2) return;
    swapped = true;
    map.removeLayer(carto);
    L.tileLayer(FALLBACK_URL, {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
      className: 'tiles-dark',
    }).addTo(map);
  });

  carto.addTo(map);
}
