// Regenerates public/brands-fra.json — the static France-wide station-brand
// index the app matches gouv stations against (see src/data/gouv/osmBrands.ts).
//
// One bulk OpenStreetMap query at build time replaces the old per-user runtime
// Overpass calls, which failed constantly (rate limits, IP blocks) and left
// whole zones labeled « Station · Ville ». Brands change rarely: re-run this
// script once in a while and commit the result. Usage: npm run build:brands
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
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

const out = {
  v: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'OpenStreetMap (Overpass, amenity=fuel, France)',
  labels,
  pois,
};
const path = join(dirname(fileURLToPath(import.meta.url)), '../public/brands-fra.json');
writeFileSync(path, JSON.stringify(out));
console.log(`${pois.length} POIs, ${labels.length} distinct labels → ${path}`);
