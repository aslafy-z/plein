// Live verification of the REAL data providers (fr flux, BAN, OSRM, es flux, CartoCiudad, ad flux) from
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
  // App-relative URLs (only /brands-fr.json today) are bundled assets: serve
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
export { FrStationsProvider } from './src/data/fr/FrStationsProvider';
export { BanGeocodeProvider } from './src/data/fr/BanGeocodeProvider';
export { RealRouteProvider } from './src/data/fr/OsrmRouteProvider';
export { EsStationsProvider } from './src/data/es/EsStationsProvider';
export { CartoCiudadGeocodeProvider } from './src/data/es/CartoCiudadGeocodeProvider';
export { AdStationsProvider } from './src/data/ad/AdStationsProvider';
export { AdGeocodeProvider } from './src/data/ad/AdGeocodeProvider';
export { PtStationsProvider } from './src/data/pt/PtStationsProvider';
export { PhotonGeocodeProvider } from './src/data/pt/PhotonGeocodeProvider';
export { AutoStationsProvider, AutoGeocodeProvider } from './src/data/auto/AutoProviders';
export { nearestOnPolyline, polylineLengthKm } from './src/lib/geo';
export { openStatus } from './src/lib/hours';
export { brandGroup, INDEPENDENT_BRAND_ID } from './src/lib/brandIcons';
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
const fr = new P.FrStationsProvider();
const near = await fr.getStationsNear(TOULOUSE, 5);
ok('fr: stations within 5 km of Toulouse', near.length >= 10, `${near.length} stations`);
ok('fr: coordinates all in France', near.every(inFrance));
const priced = near.filter((s) => s.prices.diesel || s.prices.e10 || s.prices.unleaded98);
ok('fr: most stations carry prices', priced.length >= near.length * 0.7, `${priced.length}/${near.length} priced`);
const cheapest = [...near]
  .filter((s) => s.prices.diesel)
  .sort((a, b) => a.prices.diesel.value - b.prices.diesel.value)[0];
ok('fr: plausible diesel price', cheapest && cheapest.prices.diesel.value > 1 && cheapest.prices.diesel.value < 3,
  cheapest ? `${cheapest.prices.diesel.value} €/L (${cheapest.name})` : 'none');
const branded = near.filter((s) => s.brand);
ok('fr: brands enriched from OSM', branded.length >= near.length * 0.4,
  `${branded.length}/${near.length} · ex: ${branded.slice(0, 3).map((s) => s.name).join(' / ')}`);
const index = JSON.parse(readFileSync(join(process.cwd(), 'public/brands-fr.json'), 'utf8'));
const poiSet = new Set(index.pois.map(([lat, lng]) => `${lat},${lng}`));
const snapped = near.filter((s) => poiSet.has(`${s.lat},${s.lng}`));
ok('fr: positions snapped to OSM POIs', snapped.length > 0 && snapped.length >= branded.length * 0.8,
  `${snapped.length}/${near.length} snapped`);
const withHours = near.filter((s) => s.hours);
ok('fr: opening hours parsed', withHours.length > 0, `${withHours.length}/${near.length} with hours`);
const statuses = withHours.map((s) => P.openStatus(s.hours)).filter(Boolean);
ok('fr: open-status computable', statuses.length > 0,
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
const along = await fr.getStationsAlong(route.polyline, 5);
ok('fr: stations along the corridor', along.length >= 8, `${along.length} stations`);
const alongKms = along.map(
  (s) => P.nearestOnPolyline({ lat: s.lat, lng: s.lng }, route.polyline).alongKm,
);
const spreadKm = alongKms.length ? Math.max(...alongKms) - Math.min(...alongKms) : 0;
ok('fr: corridor covers the whole route', spreadKm > route.distanceKm * 0.6,
  `spread ${Math.round(spreadKm)} km of ${Math.round(route.distanceKm)} km`);
ok('fr: every corridor station is within 5 km of the route',
  along.every((s) => P.nearestOnPolyline({ lat: s.lat, lng: s.lng }, route.polyline).distKm <= 5));

// 5 — Spanish source (MITECO flux, per-province)
const MADRID = { lat: 40.4168, lng: -3.7038 };
const es = new P.EsStationsProvider();
const esNear = await es.getStationsNear(MADRID, 5);
ok('es: stations within 5 km of Madrid', esNear.length >= 10, `${esNear.length} stations`);
const inSpain = (s) => s.lat > 27 && s.lat < 44.5 && s.lng > -19 && s.lng < 5;
ok('es: coordinates all in Spain', esNear.every(inSpain));
const esPriced = esNear.filter((s) => s.prices.diesel || s.prices.unleaded95 || s.prices.unleaded98);
ok('es: most stations carry prices', esPriced.length >= esNear.length * 0.7,
  `${esPriced.length}/${esNear.length} priced`);
const esCheapest = [...esNear]
  .filter((s) => s.prices.diesel)
  .sort((a, b) => a.prices.diesel.value - b.prices.diesel.value)[0];
ok('es: plausible diesel price', esCheapest && esCheapest.prices.diesel.value > 1 && esCheapest.prices.diesel.value < 3,
  esCheapest ? `${esCheapest.prices.diesel.value} €/L (${esCheapest.name})` : 'none');
const esBranded = esNear.filter((s) => s.brand);
ok('es: brands from the flux rótulo', esBranded.length >= esNear.length * 0.6,
  `${esBranded.length}/${esNear.length} · ex: ${esBranded.slice(0, 3).map((s) => s.name).join(' / ')}`);
const esHours = esNear.filter((s) => s.hours);
ok('es: opening hours parsed', esHours.length >= esNear.length * 0.5,
  `${esHours.length}/${esNear.length} with hours`);
const esStatuses = esHours.map((s) => P.openStatus(s.hours)).filter(Boolean);
ok('es: open-status computable', esStatuses.length > 0,
  esStatuses.slice(0, 3).map((s) => s.label).join(' / '));
const esServed = esNear.filter((s) => s.services.length > 0);
ok('es: extra products exposed as services', esServed.length > 0,
  `${esServed.length}/${esNear.length} · ex: ${esServed[0]?.services.slice(0, 3).join(' / ')}`);
// Brand grouping coverage — most stations around Lleida must resolve to a
// named « Marques » group (BonÀrea, Repsol…), not fall into Indépendants.
const LLEIDA = { lat: 41.617, lng: 0.62 };
const lleida = await es.getStationsNear(LLEIDA, 25);
const grouped = lleida.filter((s) => P.brandGroup(s.brand) !== P.INDEPENDENT_BRAND_ID);
ok('es: Lleida brands resolve to filter groups', lleida.length >= 10 && grouped.length >= lleida.length * 0.5,
  `${grouped.length}/${lleida.length} grouped`);

// 6 — CartoCiudad geocoding
const cartociudad = new P.CartoCiudadGeocodeProvider();
const esPlaces = await cartociudad.search('Zaragoza');
ok('CartoCiudad: geocodes "Zaragoza"', esPlaces.length >= 1, esPlaces[0]?.label);
ok('CartoCiudad: plausible coordinates',
  esPlaces[0] && Math.abs(esPlaces[0].point.lat - 41.65) < 1 && Math.abs(esPlaces[0].point.lng + 0.88) < 1);

// 7 — stations along a Spanish route
const GUADALAJARA = { lat: 40.6333, lng: -3.1669 };
const esRoute = await osrm.getRoute(MADRID, GUADALAJARA);
ok('OSRM: Madrid → Guadalajara distance', esRoute.distanceKm > 40 && esRoute.distanceKm < 120,
  `${Math.round(esRoute.distanceKm)} km`);
const esAlong = await es.getStationsAlong(esRoute.polyline, 5);
ok('es: stations along the corridor', esAlong.length >= 5, `${esAlong.length} stations`);
ok('es: every corridor station is within 5 km of the route',
  esAlong.every((s) => P.nearestOnPolyline({ lat: s.lat, lng: s.lng }, esRoute.polyline).distKm <= 5));

// 8 — auto source: both countries at the border, no useless queries inland
const LE_PERTHUS = { lat: 42.463, lng: 2.865 }; // French-Spanish border crossing
const auto = new P.AutoStationsProvider();
const border = await auto.getStationsNear(LE_PERTHUS, 20);
const borderEs = border.filter((s) => s.id.startsWith('es-'));
ok('auto: border zone mixes both countries', borderEs.length > 0 && borderEs.length < border.length,
  `${border.length - borderEs.length} fr + ${borderEs.length} es`);
const autoToulouse = await auto.getStationsNear(TOULOUSE, 5);
ok('auto: Toulouse stays French-only', autoToulouse.length >= 10 && autoToulouse.every((s) => !s.id.startsWith('es-')),
  `${autoToulouse.length} stations`);
const autoGeo = new P.AutoGeocodeProvider();
const autoPlaces = await autoGeo.search('Girona');
ok('auto: geocoder finds Spanish places', autoPlaces.some((p) => Math.abs(p.point.lat - 41.98) < 1 && Math.abs(p.point.lng - 2.82) < 1),
  autoPlaces.slice(0, 2).map((p) => p.label).join(' / '));

// 9 — Andorran source (Govern d'Andorra flux, whole-country fetch)
const ANDORRA_LA_VELLA = { lat: 42.5063, lng: 1.5218 };
const ad = new P.AdStationsProvider();
const adNear = await ad.getStationsNear(ANDORRA_LA_VELLA, 10);
ok('ad: stations within 10 km of Andorra la Vella', adNear.length >= 10, `${adNear.length} stations`);
const inAndorra = (s) => s.lat > 42.4 && s.lat < 42.7 && s.lng > 1.4 && s.lng < 1.8;
ok('ad: coordinates all in Andorra', adNear.every(inAndorra));
ok('ad: every station carries prices',
  adNear.every((s) => s.prices.diesel || s.prices.unleaded95 || s.prices.unleaded98));
const adCheapest = [...adNear]
  .filter((s) => s.prices.diesel)
  .sort((a, b) => a.prices.diesel.value - b.prices.diesel.value)[0];
ok('ad: plausible diesel price', adCheapest && adCheapest.prices.diesel.value > 0.8 && adCheapest.prices.diesel.value < 3,
  adCheapest ? `${adCheapest.prices.diesel.value} €/L (${adCheapest.name})` : 'none');
const adBranded = adNear.filter((s) => s.brand);
ok('ad: banners from the station names', adBranded.length >= adNear.length * 0.7,
  `${adBranded.length}/${adNear.length} · ex: ${adBranded.slice(0, 3).map((s) => s.name).join(' / ')}`);
const adGrouped = adNear.filter((s) => P.brandGroup(s.brand) !== P.INDEPENDENT_BRAND_ID);
ok('ad: brands resolve to filter groups', adGrouped.length >= adNear.length * 0.6,
  `${adGrouped.length}/${adNear.length} grouped`);
const andGeo = new P.AdGeocodeProvider();
const andPlaces = await andGeo.search('Pas de la Casa');
ok('ad: IDE geocoder finds "Pas de la Casa"',
  andPlaces.some((p) => Math.abs(p.point.lat - 42.54) < 0.1 && Math.abs(p.point.lng - 1.73) < 0.1),
  andPlaces[0]?.label);
// Accent-tolerant gazetteer lookup on a small hamlet (no hardcoded list)
const andHamlet = await andGeo.search('aixas');
ok('ad: IDE geocoder finds "Aixàs" hamlet',
  andHamlet.some((p) => Math.abs(p.point.lat - 42.487) < 0.05 && Math.abs(p.point.lng - 1.467) < 0.05),
  andHamlet[0]?.label);
const autoAndorra = await auto.getStationsNear(ANDORRA_LA_VELLA, 10);
ok('auto: Andorra zone yields Andorran stations', autoAndorra.some((s) => s.id.startsWith('ad-')),
  `${autoAndorra.filter((s) => s.id.startsWith('ad-')).length} ad of ${autoAndorra.length}`);
const autoAdPlaces = await autoGeo.search('Soldeu');
ok('auto: geocoder finds Andorran places',
  autoAdPlaces.some((p) => Math.abs(p.point.lat - 42.577) < 0.1 && Math.abs(p.point.lng - 1.667) < 0.1),
  autoAdPlaces.slice(0, 2).map((p) => p.label).join(' / '));

// 10 — Portuguese source (DGEG flux, per-district)
const LISBOA = { lat: 38.7223, lng: -9.1393 };
const pt = new P.PtStationsProvider();
const ptNear = await pt.getStationsNear(LISBOA, 5);
ok('pt: stations within 5 km of Lisboa', ptNear.length >= 10, `${ptNear.length} stations`);
const inPortugal = (s) => s.lat > 36.9 && s.lat < 42.2 && s.lng > -9.6 && s.lng < -6.1;
ok('pt: coordinates all in Portugal', ptNear.every(inPortugal));
ok('pt: every station carries a road-fuel price',
  ptNear.every((s) => s.prices.diesel || s.prices.unleaded95 || s.prices.unleaded98 || s.prices.lpg));
const ptCheapest = [...ptNear]
  .filter((s) => s.prices.diesel)
  .sort((a, b) => a.prices.diesel.value - b.prices.diesel.value)[0];
ok('pt: plausible diesel price', ptCheapest && ptCheapest.prices.diesel.value > 1 && ptCheapest.prices.diesel.value < 3,
  ptCheapest ? `${ptCheapest.prices.diesel.value} €/L (${ptCheapest.name})` : 'none');
const ptBranded = ptNear.filter((s) => s.brand);
ok('pt: banners from the flux marca', ptBranded.length >= ptNear.length * 0.6,
  `${ptBranded.length}/${ptNear.length} · ex: ${ptBranded.slice(0, 3).map((s) => s.brand).join(' / ')}`);
const ptGrouped = ptNear.filter((s) => P.brandGroup(s.brand) !== P.INDEPENDENT_BRAND_ID);
ok('pt: brands resolve to filter groups', ptGrouped.length >= ptNear.length * 0.5,
  `${ptGrouped.length}/${ptNear.length} grouped`);
const ptServed = ptNear.filter((s) => s.services.length > 0);
ok('pt: extra products exposed as services', ptServed.length > 0,
  `${ptServed.length}/${ptNear.length} · ex: ${ptServed[0]?.services.slice(0, 3).join(' / ')}`);

// 11 — Photon geocoding, pinned to Portugal
const photon = new P.PhotonGeocodeProvider();
const ptPlaces = await photon.search('Coimbra');
ok('Photon: geocodes "Coimbra"', ptPlaces.length >= 1, ptPlaces[0]?.label);
ok('Photon: the town comes before its streets',
  ptPlaces[0]?.kind === 'locality' && Math.abs(ptPlaces[0].point.lat - 40.21) < 0.5 &&
  Math.abs(ptPlaces[0].point.lng + 8.43) < 0.5,
  ptPlaces.slice(0, 3).map((p) => `${p.label} (${p.kind})`).join(' / '));
ok('Photon: stays inside Portugal', ptPlaces.every((p) => p.country === 'pt' &&
  p.point.lat > 36.9 && p.point.lat < 42.2 && p.point.lng > -9.6 && p.point.lng < -6.1));

// 12 — stations along a Portuguese route, and « auto » over Portugal
const PORTO = { lat: 41.1496, lng: -8.611 };
const ptRoute = await osrm.getRoute(LISBOA, { lat: 39.7436, lng: -8.8072 }); // Leiria
ok('OSRM: Lisboa → Leiria distance', ptRoute.distanceKm > 100 && ptRoute.distanceKm < 200,
  `${Math.round(ptRoute.distanceKm)} km`);
const ptAlong = await pt.getStationsAlong(ptRoute.polyline, 5);
ok('pt: stations along the corridor', ptAlong.length >= 5, `${ptAlong.length} stations`);
ok('pt: every corridor station is within 5 km of the route',
  ptAlong.every((s) => P.nearestOnPolyline({ lat: s.lat, lng: s.lng }, ptRoute.polyline).distKm <= 5));
const autoPorto = await auto.getStationsNear(PORTO, 5);
ok('auto: Porto yields Portuguese stations only', autoPorto.length >= 10 && autoPorto.every((s) => s.id.startsWith('pt-')),
  `${autoPorto.length} stations`);
const autoPtPlaces = await autoGeo.search('Guimarães');
ok('auto: geocoder finds Portuguese places',
  autoPtPlaces.some((p) => Math.abs(p.point.lat - 41.44) < 0.2 && Math.abs(p.point.lng + 8.29) < 0.2),
  autoPtPlaces.slice(0, 2).map((p) => p.label).join(' / '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
