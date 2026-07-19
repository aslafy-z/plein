// Live verification of the REAL data providers (fra flux, BAN, OSRM, esp flux, CartoCiudad) from
// Node — proves the fetch + parsing path against the actual endpoints without
// needing a browser (sandboxed browsers often can't reach the open internet).
//
// Node's fetch ignores HTTPS_PROXY, so requests are relayed through curl,
// which honors the proxy environment. Usage: npm run verify:live
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const pexec = promisify(execFile);

// ── curl-backed fetch (proxy-aware) ──────────────────────────────────────────
globalThis.fetch = async (url) => {
  // App-relative URLs (only /brands-fra.json today) are bundled assets: serve
  // the local file so OSM enrichment (brands + position snapping) runs too.
  if (String(url).startsWith('/')) {
    const body = readFileSync(join(process.cwd(), 'public', String(url)), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  }
  const { stdout } = await pexec(
    'curl',
    ['-sS', '--max-time', '25', '-A', 'plein-live-check/1', '-w', '\n__STATUS__%{http_code}', String(url)],
    { maxBuffer: 64e6 },
  );
  const idx = stdout.lastIndexOf('\n__STATUS__');
  const body = stdout.slice(0, idx);
  const status = parseInt(stdout.slice(idx + 11), 10);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
};

// ── Bundle the TS providers into an importable ESM module ────────────────────
const entry = `
export { FraStationsProvider } from './src/data/fra/FraStationsProvider';
export { BanGeocodeProvider } from './src/data/fra/BanGeocodeProvider';
export { RealRouteProvider } from './src/data/fra/OsrmRouteProvider';
export { EspStationsProvider } from './src/data/esp/EspStationsProvider';
export { CartoCiudadGeocodeProvider } from './src/data/esp/CartoCiudadGeocodeProvider';
export { nearestOnPolyline, polylineLengthKm } from './src/lib/geo';
export { openStatus } from './src/lib/hours';
`;
const out = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
});
const dir = mkdtempSync(join(tmpdir(), 'plein-live-'));
const modPath = join(dir, 'providers.mjs');
writeFileSync(modPath, out.outputFiles[0].text);
const P = await import(pathToFileURL(modPath).href);
rmSync(dir, { recursive: true, force: true });

// ── Checks ───────────────────────────────────────────────────────────────────
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const TOULOUSE = { lat: 43.6047, lng: 1.4442 };
const BORDEAUX = { lat: 44.8378, lng: -0.5792 };
const inFrance = (s) => s.lat > 41 && s.lat < 51.5 && s.lng > -5.5 && s.lng < 10;

// 1 — stations near Toulouse
const fra = new P.FraStationsProvider();
const near = await fra.getStationsNear(TOULOUSE, 5);
ok('fra: stations within 5 km of Toulouse', near.length >= 10, `${near.length} stations`);
ok('fra: coordinates all in France', near.every(inFrance));
const priced = near.filter((s) => s.prices.gazole || s.prices.e10 || s.prices.sp98);
ok('fra: most stations carry prices', priced.length >= near.length * 0.7, `${priced.length}/${near.length} priced`);
const cheapest = [...near]
  .filter((s) => s.prices.gazole)
  .sort((a, b) => a.prices.gazole.value - b.prices.gazole.value)[0];
ok('fra: plausible gazole price', cheapest && cheapest.prices.gazole.value > 1 && cheapest.prices.gazole.value < 3,
  cheapest ? `${cheapest.prices.gazole.value} €/L (${cheapest.name})` : 'none');
const branded = near.filter((s) => s.brand);
ok('fra: brands enriched from OSM', branded.length >= near.length * 0.4,
  `${branded.length}/${near.length} · ex: ${branded.slice(0, 3).map((s) => s.name).join(' / ')}`);
const index = JSON.parse(readFileSync(join(process.cwd(), 'public/brands-fra.json'), 'utf8'));
const poiSet = new Set(index.pois.map(([lat, lng]) => `${lat},${lng}`));
const snapped = near.filter((s) => poiSet.has(`${s.lat},${s.lng}`));
ok('fra: positions snapped to OSM POIs', snapped.length > 0 && snapped.length >= branded.length * 0.8,
  `${snapped.length}/${near.length} snapped`);
const withHours = near.filter((s) => s.hours);
ok('fra: opening hours parsed', withHours.length > 0, `${withHours.length}/${near.length} with hours`);
const statuses = withHours.map((s) => P.openStatus(s.hours)).filter(Boolean);
ok('fra: open-status computable', statuses.length > 0,
  statuses.slice(0, 3).map((s) => s.label).join(' / '));

// 2 — BAN geocoding
const ban = new P.BanGeocodeProvider();
const places = await ban.search('Bordeaux');
ok('BAN: geocodes "Bordeaux"', places.length >= 1, places[0]?.label);
ok('BAN: plausible coordinates',
  places[0] && Math.abs(places[0].point.lat - 44.84) < 1 && Math.abs(places[0].point.lng + 0.58) < 1);

// 3 — OSRM routing
const osrm = new P.RealRouteProvider();
const route = await osrm.getRoute(TOULOUSE, BORDEAUX);
ok('OSRM: Toulouse → Bordeaux distance', route.distanceKm > 200 && route.distanceKm < 350,
  `${Math.round(route.distanceKm)} km · ${Math.round(route.durationMin)} min`);
ok('OSRM: dense polyline', route.polyline.length > 100, `${route.polyline.length} pts`);

// 4 — stations along the real route (corridor coverage)
const along = await fra.getStationsAlong(route.polyline, 5);
ok('fra: stations along the corridor', along.length >= 8, `${along.length} stations`);
const alongKms = along.map(
  (s) => P.nearestOnPolyline({ lat: s.lat, lng: s.lng }, route.polyline).alongKm,
);
const spreadKm = alongKms.length ? Math.max(...alongKms) - Math.min(...alongKms) : 0;
ok('fra: corridor covers the whole route', spreadKm > route.distanceKm * 0.6,
  `spread ${Math.round(spreadKm)} km of ${Math.round(route.distanceKm)} km`);
ok('fra: every corridor station is within 5 km of the route',
  along.every((s) => P.nearestOnPolyline({ lat: s.lat, lng: s.lng }, route.polyline).distKm <= 5));

// 5 — Spanish source (MITECO flux, per-province)
const MADRID = { lat: 40.4168, lng: -3.7038 };
const esp = new P.EspStationsProvider();
const espNear = await esp.getStationsNear(MADRID, 5);
ok('esp: stations within 5 km of Madrid', espNear.length >= 10, `${espNear.length} stations`);
const inSpain = (s) => s.lat > 27 && s.lat < 44.5 && s.lng > -19 && s.lng < 5;
ok('esp: coordinates all in Spain', espNear.every(inSpain));
const espPriced = espNear.filter((s) => s.prices.gazole || s.prices.sp95 || s.prices.sp98);
ok('esp: most stations carry prices', espPriced.length >= espNear.length * 0.7,
  `${espPriced.length}/${espNear.length} priced`);
const espCheapest = [...espNear]
  .filter((s) => s.prices.gazole)
  .sort((a, b) => a.prices.gazole.value - b.prices.gazole.value)[0];
ok('esp: plausible gazole price', espCheapest && espCheapest.prices.gazole.value > 1 && espCheapest.prices.gazole.value < 3,
  espCheapest ? `${espCheapest.prices.gazole.value} €/L (${espCheapest.name})` : 'none');
const espBranded = espNear.filter((s) => s.brand);
ok('esp: brands from the flux rótulo', espBranded.length >= espNear.length * 0.6,
  `${espBranded.length}/${espNear.length} · ex: ${espBranded.slice(0, 3).map((s) => s.name).join(' / ')}`);
const espHours = espNear.filter((s) => s.hours);
ok('esp: opening hours parsed', espHours.length >= espNear.length * 0.5,
  `${espHours.length}/${espNear.length} with hours`);
const espStatuses = espHours.map((s) => P.openStatus(s.hours)).filter(Boolean);
ok('esp: open-status computable', espStatuses.length > 0,
  espStatuses.slice(0, 3).map((s) => s.label).join(' / '));

// 6 — CartoCiudad geocoding
const cartociudad = new P.CartoCiudadGeocodeProvider();
const espPlaces = await cartociudad.search('Zaragoza');
ok('CartoCiudad: geocodes "Zaragoza"', espPlaces.length >= 1, espPlaces[0]?.label);
ok('CartoCiudad: plausible coordinates',
  espPlaces[0] && Math.abs(espPlaces[0].point.lat - 41.65) < 1 && Math.abs(espPlaces[0].point.lng + 0.88) < 1);

// 7 — stations along a Spanish route
const GUADALAJARA = { lat: 40.6333, lng: -3.1669 };
const espRoute = await osrm.getRoute(MADRID, GUADALAJARA);
ok('OSRM: Madrid → Guadalajara distance', espRoute.distanceKm > 40 && espRoute.distanceKm < 120,
  `${Math.round(espRoute.distanceKm)} km`);
const espAlong = await esp.getStationsAlong(espRoute.polyline, 5);
ok('esp: stations along the corridor', espAlong.length >= 5, `${espAlong.length} stations`);
ok('esp: every corridor station is within 5 km of the route',
  espAlong.every((s) => P.nearestOnPolyline({ lat: s.lat, lng: s.lng }, espRoute.polyline).distKm <= 5));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
