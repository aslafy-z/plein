// Regenerates public/brands-fr.json — the static France-wide station-brand
// index the app matches gouv stations against (see src/data/fr/osmBrands.ts).
//
// One bulk OpenStreetMap query at build time replaces the old per-user runtime
// Overpass calls, which failed constantly (rate limits, IP blocks) and left
// whole zones labeled « Station · Ville ». Brands change rarely: re-run this
// script once in a while and commit the result. Usage: npm run build:brands
//
// It also links the gouv stations sitting too far from their POI for the
// runtime match (scripts/brandLinks.mjs), so it reads the whole gouv flux too.
// `npm run build:brands -- --links-only` recomputes just those links against
// the POIs already in the file, when Overpass is down or the flux has moved.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { gouvPosition, linkStations } from './brandLinks.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pexec = promisify(execFile);

// area 3602202162 = relation 2202162, France (including overseas)
const QUERY =
  '[out:json][timeout:180];area(id:3602202162)->.fr;' +
  'nwr["amenity"="fuel"](area.fr);out center tags;';

const MIRRORS = [
  'https://overpass-api.de',
  'https://maps.mail.ru/osm/tools/overpass',
  'https://overpass.kumi.systems',
];

const UA = 'plein-brand-index-build/1 (github.com/aslafy-z/plein)';

// curl honors HTTPS_PROXY (sandboxed environments); Node fetch does not.
async function fetchJson(url) {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    const { stdout } = await pexec(
      'curl',
      ['-sS', '--fail', '--max-time', '200', '-A', UA, url],
      { maxBuffer: 256e6 },
    );
    return JSON.parse(stdout);
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(200_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchPois() {
  let lastErr;
  for (const base of MIRRORS) {
    const url = `${base}/api/interpreter?data=${encodeURIComponent(QUERY)}`;
    try {
      console.log(`fetching ${base} …`);
      return await fetchJson(url);
    } catch (err) {
      console.warn(`  ${base} failed: ${err.message ?? err}`);
      lastErr = err;
    }
  }
  throw lastErr;
}

// The whole flux in one export call: ids and positions only (~10 000 rows)
const GOUV_EXPORT =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/' +
  'prix-des-carburants-en-france-flux-instantane-v2/exports/json?select=id,latitude,longitude,geom';

async function fetchGouvStations() {
  let rows;
  for (let attempt = 1; !rows; attempt++) {
    try {
      rows = await fetchJson(GOUV_EXPORT);
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`  gouv flux attempt ${attempt} failed: ${err.message ?? err}`);
    }
  }
  const stations = [];
  for (const rec of rows) {
    const pos = gouvPosition(rec);
    const id = Number(rec.id);
    if (pos && Number.isInteger(id)) stations.push({ id, ...pos });
  }
  if (stations.length < 5000) throw new Error(`gouv flux: only ${stations.length} stations`);
  return stations;
}

const path = join(dirname(fileURLToPath(import.meta.url)), '../public/brands-fr.json');

function withLinks(index, stations) {
  const pois = index.pois.map(([lat, lng]) => ({ lat, lng }));
  return { ...index, links: linkStations(stations, pois) };
}

if (process.argv.includes('--links-only')) {
  const index = JSON.parse(readFileSync(path, 'utf8'));
  console.log('fetching the gouv flux …');
  const out = withLinks(index, await fetchGouvStations());
  writeFileSync(path, JSON.stringify(out));
  console.log(`${out.links.length} links over ${out.pois.length} POIs → ${path}`);
  process.exit(0);
}

const data = await fetchPois();
const labels = [];
const labelIdx = new Map();
const pois = [];
for (const el of data.elements ?? []) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const label = (el.tags?.brand ?? el.tags?.name ?? el.tags?.operator)?.trim();
  if (lat == null || lng == null) continue;
  // Unlabeled stations are kept (label index -1): they donate no brand, but
  // their OSM position still corrects the flux's imprecise coordinates.
  let i = -1;
  if (label) {
    i = labelIdx.get(label);
    if (i === undefined) {
      i = labels.length;
      labelIdx.set(label, i);
      labels.push(label);
    }
  }
  // 5 decimals ≈ 1 m — plenty for the 150 m matching threshold
  pois.push([Number(lat.toFixed(5)), Number(lng.toFixed(5)), i]);
}

console.log('fetching the gouv flux …');
const out = withLinks(
  {
    v: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap (Overpass, amenity=fuel, France)',
    labels,
    pois,
  },
  await fetchGouvStations(),
);
writeFileSync(path, JSON.stringify(out));
console.log(
  `${pois.length} POIs, ${labels.length} distinct labels, ${out.links.length} links → ${path}`,
);
