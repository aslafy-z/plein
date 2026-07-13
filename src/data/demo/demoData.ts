// Offline, deterministic demo dataset — realistic France, centred on Lyon.
// All coordinates are plausible-but-approximate; the demo route provider draws
// straight lines, so corridor stations are placed along those lines (with a
// generous tolerance in DemoStationsProvider) rather than at exact city points.
import type { GeoPoint } from '../../lib/geo';
import { lerpPoint } from '../../lib/geo';
import type { DayHours, StationHours } from '../../lib/hours';
import type { BrandCat, FuelId, FuelPrice, ServiceTag, Station } from '../types';

// ── Shared helpers ───────────────────────────────────────────────────────────
const NOW = Date.now();
const LYON: GeoPoint = { lat: 45.7406, lng: 4.8156 };

function hoursAgo(h: number): string {
  return new Date(NOW - h * 3_600_000).toISOString();
}

const TAG_RULES: ReadonlyArray<readonly [ServiceTag, RegExp]> = [
  ['24/24', /24.*24|automate.*24/i],
  ['Lavage', /avage/i],
  ['Boutique', /outique/i],
  ['Gonflage', /onflage/i],
];

/** Derive normalized filter tags from raw service labels (shared shape with gouv) */
export function tagsFromServices(services: string[]): ServiceTag[] {
  const joined = services.join(' ');
  return TAG_RULES.filter(([, re]) => re.test(joined)).map(([tag]) => tag);
}

interface StationSpec {
  id: string;
  name: string;
  init: string;
  brand: string;
  cat: BrandCat;
  lat: number;
  lng: number;
  address: string;
  city: string;
  cp: string;
  h: number; // hours since last update
  conf?: number;
  highway?: boolean;
  services: string[];
  prices: Partial<Record<FuelId, number>>;
  /** Staffed opening range "HH:MM-HH:MM" (24/24 derived from services); Sunday closed when `sundayOff` */
  open?: string;
  sundayOff?: boolean;
}

function clockMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** 24/24 stations from their services; otherwise a staffed daily range */
function hoursFromSpec(spec: StationSpec): StationHours | undefined {
  const auto24 = /24.?\/?.?24|24.24/.test(spec.services.join(' '));
  if (auto24) return { auto24: true, days: {} };
  if (!spec.open) return undefined;
  const [o, c] = spec.open.split('-');
  const range = { open: clockMin(o), close: clockMin(c) };
  const days: Partial<Record<number, DayHours>> = {};
  for (let d = 1; d <= 7; d++) {
    days[d] =
      d === 7 && spec.sundayOff ? { closed: true, ranges: [] } : { closed: false, ranges: [range] };
  }
  return { auto24: false, days };
}

function build(spec: StationSpec): Station {
  const updatedAt = hoursAgo(spec.h);
  const prices: Partial<Record<FuelId, FuelPrice>> = {};
  (Object.keys(spec.prices) as FuelId[]).forEach((f) => {
    const value = spec.prices[f];
    if (value != null) prices[f] = { value, updatedAt };
  });
  return {
    id: spec.id,
    name: spec.name,
    init: spec.init,
    brand: spec.brand,
    cat: spec.cat,
    lat: spec.lat,
    lng: spec.lng,
    address: spec.address,
    city: spec.city,
    cp: spec.cp,
    prices,
    tags: tagsFromServices(spec.services),
    services: spec.services,
    highway: spec.highway ?? false,
    hours: hoursFromSpec(spec),
    confirmations: spec.conf,
  };
}

// ── Stations around Lyon Confluence (radius slider matters: 0.6 → ~19 km) ─────
export const DEMO_STATIONS: Station[] = [
  // The six stations from the design prototype (exact names / prices / services)
  build({
    id: 'su', name: 'Station U · Croix-Blanche', init: 'SU', brand: 'Système U', cat: 'gs',
    lat: 45.7460, lng: 4.8233, address: '12 route de la Croix-Blanche', city: 'Lyon', cp: '69002',
    h: 2, conf: 12, services: ['Ouvert 24/24', 'Lavage', 'Boutique', 'Gonflage'],
    prices: { gazole: 1.67, e10: 1.78, e85: 0.84, sp95: 1.82, sp98: 1.88 },
  }),
  build({
    id: 'in', name: 'Intermarché · Les Vignes', init: 'IN', brand: 'Intermarché', cat: 'gs',
    lat: 45.7550, lng: 4.8300, address: '45 avenue des Vignes', city: 'Villeurbanne', cp: '69100',
    h: 3, conf: 8, services: ['Ouvert 24/24', 'Lavage'],
    prices: { gazole: 1.69, e10: 1.79, e85: 0.86, sp95: 1.83, sp98: 1.89 },
  }),
  build({
    id: 'ca', open: '07:00-21:30', name: 'Carrefour Market', init: 'CA', brand: 'Carrefour', cat: 'gs',
    lat: 45.7250, lng: 4.7950, address: '2 rue du Marché', city: 'Lyon', cp: '69007',
    h: 26, conf: 5, services: ['Boutique'],
    prices: { gazole: 1.74, e10: 1.84, e85: 0.88, sp95: 1.88, sp98: 1.94 },
  }),
  build({
    id: 'mo', open: '08:00-19:00', sundayOff: true, name: 'Garage Morel', init: 'GM', brand: 'Indépendant', cat: 'ind',
    lat: 45.7180, lng: 4.8400, address: '8 rue Morel', city: 'Bron', cp: '69500',
    h: 28, conf: 3, services: ['Gonflage'],
    prices: { gazole: 1.72, e10: 1.83 },
  }),
  build({
    id: 'te', name: 'TotalEnergies · Centre', init: 'TE', brand: 'TotalEnergies', cat: 'pet',
    lat: 45.7360, lng: 4.8100, address: '1 quai Perrache', city: 'Lyon', cp: '69002',
    h: 1, conf: 15, services: ['Ouvert 24/24', 'Lavage', 'Boutique', 'Gonflage'],
    prices: { gazole: 1.82, e10: 1.89, e85: 0.89, sp95: 1.93, sp98: 1.99 },
  }),
  build({
    id: 'bp', name: 'BP · Rocade Est', init: 'BP', brand: 'BP', cat: 'pet',
    lat: 45.7600, lng: 4.8600, address: 'Rocade Est', city: 'Vaulx-en-Velin', cp: '69120',
    h: 5, conf: 6, services: ['Ouvert 24/24', 'Boutique'],
    prices: { gazole: 1.80, e10: 1.88, sp95: 1.92, sp98: 1.98 },
  }),
  // Eight more, spread 3–19 km out, all six fuels represented across the set
  build({
    id: 'es', name: 'Esso Express · Villeurbanne', init: 'ES', brand: 'Esso', cat: 'pet',
    lat: 45.7700, lng: 4.8800, address: '210 cours Émile-Zola', city: 'Villeurbanne', cp: '69100',
    h: 4, conf: 7, services: ['Ouvert 24/24', 'Boutique'],
    prices: { gazole: 1.79, e10: 1.85, sp95: 1.89, sp98: 1.95, e85: 0.87, gplc: 1.02 },
  }),
  build({
    id: 'le', open: '06:30-22:00', name: 'E.Leclerc · Vénissieux', init: 'EL', brand: 'Leclerc', cat: 'gs',
    lat: 45.6970, lng: 4.8850, address: '5 boulevard Ambroise-Croizat', city: 'Vénissieux', cp: '69200',
    h: 2, conf: 20, services: ['Lavage', 'Boutique', 'Gonflage'],
    prices: { gazole: 1.65, e10: 1.75, sp95: 1.79, sp98: 1.85, e85: 0.83, gplc: 0.99 },
  }),
  build({
    id: 'au', open: '07:00-21:00', name: 'Auchan · Caluire', init: 'AU', brand: 'Auchan', cat: 'gs',
    lat: 45.7950, lng: 4.8400, address: '2 rue Pasteur', city: 'Caluire-et-Cuire', cp: '69300',
    h: 6, conf: 11, services: ['Lavage', 'Boutique'],
    prices: { gazole: 1.66, e10: 1.76, sp95: 1.80, sp98: 1.86, e85: 0.84 },
  }),
  build({
    id: 'av', name: 'Avia · Bron', init: 'AV', brand: 'Avia', cat: 'ind',
    lat: 45.7350, lng: 4.9100, address: '90 avenue Franklin-Roosevelt', city: 'Bron', cp: '69500',
    h: 8, conf: 4, services: ['Gonflage'],
    prices: { gazole: 1.73, e10: 1.83, sp98: 1.93 },
  }),
  build({
    id: 'ag', name: 'Agip · Saint-Priest', init: 'AG', brand: 'Agip', cat: 'pet',
    lat: 45.6960, lng: 4.9440, address: '15 route de Grenoble', city: 'Saint-Priest', cp: '69800',
    h: 3, conf: 9, services: ['Ouvert 24/24', 'Boutique'],
    prices: { gazole: 1.78, e10: 1.87, sp95: 1.91, sp98: 1.97, gplc: 1.05 },
  }),
  build({
    id: 'tac', name: 'Total Access · Oullins', init: 'TA', brand: 'Total Access', cat: 'pet',
    lat: 45.7150, lng: 4.7550, address: '3 grande rue', city: 'Oullins', cp: '69600',
    h: 1, conf: 13, services: ['Ouvert 24/24', 'Lavage', 'Boutique'],
    prices: { gazole: 1.71, e10: 1.81, sp95: 1.85, sp98: 1.91, e85: 0.85 },
  }),
  build({
    id: 'ir', name: 'Intermarché · Rillieux', init: 'IR', brand: 'Intermarché', cat: 'gs',
    lat: 45.8300, lng: 4.9200, address: '1 avenue de l\'Europe', city: 'Rillieux-la-Pape', cp: '69140',
    h: 5, conf: 14, services: ['Ouvert 24/24', 'Lavage', 'Boutique', 'Gonflage'],
    prices: { gazole: 1.68, e10: 1.78, sp95: 1.82, sp98: 1.88, e85: 0.85, gplc: 1.00 },
  }),
  build({
    id: 'cg', open: '07:30-21:00', name: 'Carrefour · Givors', init: 'CG', brand: 'Carrefour', cat: 'gs',
    lat: 45.5700, lng: 4.7700, address: 'ZAC des Vernes', city: 'Givors', cp: '69700',
    h: 7, conf: 6, services: ['Lavage', 'Boutique'],
    prices: { gazole: 1.70, e10: 1.80, sp95: 1.84, sp98: 1.90, e85: 0.86 },
  }),
];

// ── Corridor stations, placed along straight lines out of Lyon ────────────────
const DEST = {
  bordeaux: { lat: 44.8378, lng: -0.5792 },
  paris: { lat: 48.8412, lng: 2.3003 },
  annecy: { lat: 45.8992, lng: 6.1294 },
  marseille: { lat: 43.2965, lng: 5.3698 },
} as const;

/** Point at fraction f along the Lyon→dest straight line, nudged offKm north. */
function along(dest: GeoPoint, f: number, offKm: number): GeoPoint {
  const p = lerpPoint(LYON, dest, f);
  return { lat: p.lat + offKm / 111, lng: p.lng };
}

interface RouteSpec extends Omit<StationSpec, 'lat' | 'lng'> {
  dest: GeoPoint;
  f: number;
  off: number;
}

function buildRoute(spec: RouteSpec): Station {
  const { dest, f, off, ...rest } = spec;
  const p = along(dest, f, off);
  return build({ ...rest, lat: p.lat, lng: p.lng });
}

export const DEMO_ROUTE_STATIONS: Station[] = [
  // Lyon → Bordeaux (the five design stops)
  buildRoute({
    id: 'r-roanne', open: '07:00-21:00', name: 'Intermarché · Roanne', init: 'IN', brand: 'Intermarché', cat: 'gs',
    dest: DEST.bordeaux, f: 0.155, off: 0.6, address: 'RN7', city: 'Roanne', cp: '42300',
    h: 2, services: ['Boutique'], prices: { gazole: 1.71, e10: 1.81, e85: 0.86 },
  }),
  buildRoute({
    id: 'r-a89', name: 'Total Relais · A89', init: 'TO', brand: 'TotalEnergies', cat: 'pet',
    dest: DEST.bordeaux, f: 0.275, off: 0, highway: true, address: 'Aire de l\'A89', city: 'Noirétable', cp: '42440',
    h: 3, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.84, e10: 1.96, e85: 0.90 },
  }),
  buildRoute({
    id: 'r-clermont', open: '06:30-22:00', name: 'Leclerc · Clermont-Sud', init: 'LE', brand: 'Leclerc', cat: 'gs',
    dest: DEST.bordeaux, f: 0.401, off: -1.0, address: 'ZAC du Brézet', city: 'Clermont-Ferrand', cp: '63000',
    h: 1, services: ['Lavage', 'Boutique'], prices: { gazole: 1.66, e10: 1.76, e85: 0.84 },
  }),
  buildRoute({
    id: 'r-brive', open: '07:00-21:00', name: 'Carrefour · Brive Ouest', init: 'CA', brand: 'Carrefour', cat: 'gs',
    dest: DEST.bordeaux, f: 0.562, off: -4.5, address: 'Avenue du Teinchurier', city: 'Brive-la-Gaillarde', cp: '19100',
    h: 4, services: ['Lavage', 'Boutique'], prices: { gazole: 1.63, e10: 1.73, e85: 0.83 },
  }),
  buildRoute({
    id: 'r-libourne', open: '07:00-21:30', name: 'Super U · Libourne', init: 'SU', brand: 'Système U', cat: 'gs',
    dest: DEST.bordeaux, f: 0.851, off: 2.0, address: 'Route de Bordeaux', city: 'Libourne', cp: '33500',
    h: 2, services: ['Boutique', 'Gonflage'], prices: { gazole: 1.73, e10: 1.83, e85: 0.87 },
  }),
  buildRoute({
    id: 'r-perigueux', open: '08:00-19:30', sundayOff: true, name: 'Avia · Périgueux Est', init: 'AV', brand: 'Avia', cat: 'ind',
    dest: DEST.bordeaux, f: 0.720, off: -3.0, address: 'RN21', city: 'Périgueux', cp: '24000',
    h: 6, services: ['Gonflage'], prices: { gazole: 1.68, e10: 1.78 },
  }),

  // Lyon → Paris
  buildRoute({
    id: 'p-macon', name: 'Total · Mâcon Nord', init: 'TO', brand: 'TotalEnergies', cat: 'pet',
    dest: DEST.paris, f: 0.150, off: 0.5, address: 'RN6', city: 'Mâcon', cp: '71000',
    h: 3, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.75, e10: 1.85, e85: 0.88 },
  }),
  buildRoute({
    id: 'p-chalon', name: 'Leclerc · Chalon-sur-Saône', init: 'LE', brand: 'Leclerc', cat: 'gs',
    dest: DEST.paris, f: 0.280, off: -0.8, address: 'ZAC de la Thalie', city: 'Chalon-sur-Saône', cp: '71100',
    h: 2, services: ['Lavage', 'Boutique'], prices: { gazole: 1.67, e10: 1.77, e85: 0.85 },
  }),
  buildRoute({
    id: 'p-beaune', name: 'Intermarché · Beaune', init: 'IN', brand: 'Intermarché', cat: 'gs',
    dest: DEST.paris, f: 0.376, off: 1.2, address: 'Route de Pommard', city: 'Beaune', cp: '21200',
    h: 5, services: ['Boutique'], prices: { gazole: 1.69, e10: 1.79 },
  }),
  buildRoute({
    id: 'p-avallon', name: 'Avia · Avallon', init: 'AV', brand: 'Avia', cat: 'ind',
    dest: DEST.paris, f: 0.580, off: -1.5, address: 'RN6', city: 'Avallon', cp: '89200',
    h: 6, services: ['Gonflage'], prices: { gazole: 1.72, e10: 1.82 },
  }),
  buildRoute({
    id: 'p-sens', name: 'Carrefour · Sens', init: 'CA', brand: 'Carrefour', cat: 'gs',
    dest: DEST.paris, f: 0.680, off: 2.0, address: 'Avenue Vauban', city: 'Sens', cp: '89100',
    h: 4, services: ['Lavage', 'Boutique'], prices: { gazole: 1.70, e10: 1.80, e85: 0.86 },
  }),
  buildRoute({
    id: 'p-nemours', name: 'Total Access · Nemours', init: 'TA', brand: 'Total Access', cat: 'pet',
    dest: DEST.paris, f: 0.817, off: -1.0, address: 'A6 sortie 17', city: 'Nemours', cp: '77140',
    h: 3, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.78, e10: 1.88, e85: 0.89 },
  }),

  // Lyon → Annecy
  buildRoute({
    id: 'a-belley', name: 'Super U · Belley', init: 'SU', brand: 'Système U', cat: 'gs',
    dest: DEST.annecy, f: 0.500, off: 0.8, address: 'Avenue Hoff', city: 'Belley', cp: '01300',
    h: 3, services: ['Lavage', 'Boutique'], prices: { gazole: 1.74, e10: 1.84, e85: 0.90 },
  }),
  buildRoute({
    id: 'a-aix', name: 'Total · Aix-les-Bains', init: 'TO', brand: 'TotalEnergies', cat: 'pet',
    dest: DEST.annecy, f: 0.700, off: -1.2, address: 'Avenue du Grand-Port', city: 'Aix-les-Bains', cp: '73100',
    h: 2, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.79, e10: 1.89 },
  }),
  buildRoute({
    id: 'a-chambery', name: 'Carrefour · Chambéry', init: 'CA', brand: 'Carrefour', cat: 'gs',
    dest: DEST.annecy, f: 0.780, off: 1.5, address: 'Rue du Granier', city: 'Chambéry', cp: '73000',
    h: 5, services: ['Lavage', 'Boutique'], prices: { gazole: 1.76, e10: 1.86 },
  }),
  buildRoute({
    id: 'a-rumilly', name: 'Intermarché · Rumilly', init: 'IN', brand: 'Intermarché', cat: 'gs',
    dest: DEST.annecy, f: 0.845, off: -0.9, address: 'Route d\'Aix', city: 'Rumilly', cp: '74150',
    h: 4, services: ['Boutique', 'Gonflage'], prices: { gazole: 1.71, e10: 1.81, e85: 0.86 },
  }),

  // Lyon → Marseille (Rhône valley)
  buildRoute({
    id: 'm-vienne', name: 'Total Relais · Vienne', init: 'TO', brand: 'TotalEnergies', cat: 'pet',
    dest: DEST.marseille, f: 0.095, off: 0.6, address: 'RN7', city: 'Vienne', cp: '38200',
    h: 2, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.73, e10: 1.83, e85: 0.87 },
  }),
  buildRoute({
    id: 'm-valence', name: 'Leclerc · Valence Sud', init: 'LE', brand: 'Leclerc', cat: 'gs',
    dest: DEST.marseille, f: 0.317, off: -1.0, address: 'Avenue de Provence', city: 'Valence', cp: '26000',
    h: 1, services: ['Lavage', 'Boutique', 'Gonflage'], prices: { gazole: 1.65, e10: 1.75, e85: 0.84 },
  }),
  buildRoute({
    id: 'm-montelimar', name: 'Carrefour · Montélimar', init: 'CA', brand: 'Carrefour', cat: 'gs',
    dest: DEST.marseille, f: 0.476, off: 1.4, address: 'Avenue du Teil', city: 'Montélimar', cp: '26200',
    h: 5, services: ['Lavage', 'Boutique'], prices: { gazole: 1.68, e10: 1.78 },
  }),
  buildRoute({
    id: 'm-orange', name: 'Avia · Orange', init: 'AV', brand: 'Avia', cat: 'ind',
    dest: DEST.marseille, f: 0.667, off: -1.2, address: 'Route de Caderousse', city: 'Orange', cp: '84100',
    h: 6, services: ['Boutique'], prices: { gazole: 1.70, e10: 1.80, e85: 0.85 },
  }),
  buildRoute({
    id: 'm-salon', name: 'Intermarché · Salon-de-Provence', init: 'IN', brand: 'Intermarché', cat: 'gs',
    dest: DEST.marseille, f: 0.850, off: 1.8, address: 'RN569', city: 'Salon-de-Provence', cp: '13300',
    h: 4, services: ['Boutique', 'Gonflage'], prices: { gazole: 1.72, e10: 1.82 },
  }),
  buildRoute({
    id: 'm-aix', name: 'Agip · Aix-en-Provence', init: 'AG', brand: 'Agip', cat: 'pet',
    dest: DEST.marseille, f: 0.920, off: -1.0, highway: true, address: 'A8 aire d\'Aix', city: 'Aix-en-Provence', cp: '13100',
    h: 3, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.81, e10: 1.91 },
  }),
];

// ── Geocoder dictionary ───────────────────────────────────────────────────────
export interface DemoPlace {
  label: string;
  sublabel: string;
  point: GeoPoint;
}

export const DEMO_PLACES: DemoPlace[] = [
  { label: 'Lyon Confluence', sublabel: 'Rhône', point: { lat: 45.7406, lng: 4.8156 } },
  { label: 'Bordeaux centre', sublabel: 'Gironde', point: { lat: 44.8378, lng: -0.5792 } },
  { label: 'Paris 15e', sublabel: 'Paris', point: { lat: 48.8412, lng: 2.3003 } },
  { label: 'Annecy', sublabel: 'Haute-Savoie', point: { lat: 45.8992, lng: 6.1294 } },
  { label: 'Marseille', sublabel: 'Bouches-du-Rhône', point: { lat: 43.2965, lng: 5.3698 } },
  { label: 'Toulouse', sublabel: 'Haute-Garonne', point: { lat: 43.6047, lng: 1.4442 } },
  { label: 'Lille', sublabel: 'Nord', point: { lat: 50.6292, lng: 3.0573 } },
  { label: 'Nantes', sublabel: 'Loire-Atlantique', point: { lat: 47.2184, lng: -1.5536 } },
  { label: 'Strasbourg', sublabel: 'Bas-Rhin', point: { lat: 48.5734, lng: 7.7521 } },
  { label: 'Montpellier', sublabel: 'Hérault', point: { lat: 43.6108, lng: 3.8767 } },
  { label: 'Grenoble', sublabel: 'Isère', point: { lat: 45.1885, lng: 5.7245 } },
  { label: 'Dijon', sublabel: 'Côte-d\'Or', point: { lat: 47.3220, lng: 5.0415 } },
  { label: 'Clermont-Ferrand', sublabel: 'Puy-de-Dôme', point: { lat: 45.7772, lng: 3.0870 } },
  { label: 'Saint-Étienne', sublabel: 'Loire', point: { lat: 45.4397, lng: 4.3872 } },
  { label: 'Nice', sublabel: 'Alpes-Maritimes', point: { lat: 43.7102, lng: 7.2620 } },
  { label: 'Rennes', sublabel: 'Ille-et-Vilaine', point: { lat: 48.1173, lng: -1.6778 } },
];
