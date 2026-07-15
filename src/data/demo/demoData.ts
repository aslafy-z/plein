// Offline, deterministic demo dataset — realistic France, centred on Toulouse.
// All coordinates are plausible-but-approximate; the demo route provider draws
// straight lines, so corridor stations are placed along those lines (with a
// generous tolerance in DemoStationsProvider) rather than at exact city points.
import type { GeoPoint } from '../../lib/geo';
import { lerpPoint } from '../../lib/geo';
import type { DayHours, StationHours } from '../../lib/hours';
import type { BrandCat, FuelId, FuelPrice, ServiceTag, Station } from '../types';

// ── Shared helpers ───────────────────────────────────────────────────────────
const NOW = Date.now();
const TOULOUSE: GeoPoint = { lat: 43.6047, lng: 1.4442 };

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

// ── Stations around Toulouse Capitole (radius slider matters: 0.6 → ~19 km) ───
export const DEMO_STATIONS: Station[] = [
  // The six stations from the design prototype (exact names / prices / services)
  build({
    id: 'su', name: 'Station U · Croix-Blanche', init: 'SU', brand: 'Système U', cat: 'gs',
    lat: 43.6101, lng: 1.4519, address: '12 route de la Croix-Blanche', city: 'Toulouse', cp: '31000',
    h: 2, conf: 12, services: ['Ouvert 24/24', 'Lavage', 'Boutique', 'Gonflage'],
    prices: { gazole: 1.67, e10: 1.78, e85: 0.84, sp95: 1.82, sp98: 1.88 },
  }),
  build({
    id: 'in', name: 'Intermarché · Les Vignes', init: 'IN', brand: 'Intermarché', cat: 'gs',
    lat: 43.6191, lng: 1.4586, address: '45 avenue des Vignes', city: 'Toulouse', cp: '31200',
    h: 3, conf: 8, services: ['Ouvert 24/24', 'Lavage'],
    prices: { gazole: 1.69, e10: 1.79, e85: 0.86, sp95: 1.83, sp98: 1.89 },
  }),
  build({
    id: 'ca', open: '07:00-21:30', name: 'Carrefour Market', init: 'CA', brand: 'Carrefour', cat: 'gs',
    lat: 43.5891, lng: 1.4236, address: '2 rue du Marché', city: 'Toulouse', cp: '31300',
    h: 26, conf: 5, services: ['Boutique'],
    prices: { gazole: 1.74, e10: 1.84, e85: 0.88, sp95: 1.88, sp98: 1.94 },
  }),
  build({
    id: 'mo', open: '08:00-19:00', sundayOff: true, name: 'Garage Morel', init: 'GM', brand: 'Indépendant', cat: 'ind',
    lat: 43.5821, lng: 1.4686, address: '8 rue Morel', city: 'Toulouse', cp: '31400',
    h: 28, conf: 3, services: ['Gonflage'],
    prices: { gazole: 1.72, e10: 1.83 },
  }),
  build({
    id: 'te', name: 'TotalEnergies · Centre', init: 'TE', brand: 'TotalEnergies', cat: 'pet',
    lat: 43.6001, lng: 1.4386, address: '1 allée Jules-Guesde', city: 'Toulouse', cp: '31000',
    h: 1, conf: 15, services: ['Ouvert 24/24', 'Lavage', 'Boutique', 'Gonflage'],
    prices: { gazole: 1.82, e10: 1.89, e85: 0.89, sp95: 1.93, sp98: 1.99 },
  }),
  build({
    id: 'bp', name: 'BP · Rocade Est', init: 'BP', brand: 'BP', cat: 'pet',
    lat: 43.6241, lng: 1.4886, address: 'Rocade Est', city: 'Toulouse', cp: '31500',
    h: 5, conf: 6, services: ['Ouvert 24/24', 'Boutique'],
    prices: { gazole: 1.80, e10: 1.88, sp95: 1.92, sp98: 1.98 },
  }),
  // Eight more, spread 3–19 km out, all six fuels represented across the set
  build({
    id: 'es', name: 'Esso Express · L\'Union', init: 'ES', brand: 'Esso', cat: 'pet',
    lat: 43.6341, lng: 1.5086, address: '210 route d\'Albi', city: 'L\'Union', cp: '31240',
    h: 4, conf: 7, services: ['Ouvert 24/24', 'Boutique'],
    prices: { gazole: 1.79, e10: 1.85, sp95: 1.89, sp98: 1.95, e85: 0.87, gplc: 1.02 },
  }),
  build({
    id: 'le', open: '06:30-22:00', name: 'E.Leclerc · Labège', init: 'EL', brand: 'Leclerc', cat: 'gs',
    lat: 43.5611, lng: 1.5136, address: '5 avenue de l\'Occitanie', city: 'Labège', cp: '31670',
    h: 2, conf: 20, services: ['Lavage', 'Boutique', 'Gonflage'],
    prices: { gazole: 1.65, e10: 1.75, sp95: 1.79, sp98: 1.85, e85: 0.83, gplc: 0.99 },
  }),
  build({
    id: 'au', open: '07:00-21:00', name: 'Auchan · Launaguet', init: 'AU', brand: 'Auchan', cat: 'gs',
    lat: 43.6591, lng: 1.4686, address: '2 rue Pasteur', city: 'Launaguet', cp: '31140',
    h: 6, conf: 11, services: ['Lavage', 'Boutique'],
    prices: { gazole: 1.66, e10: 1.76, sp95: 1.80, sp98: 1.86, e85: 0.84 },
  }),
  build({
    id: 'av', name: 'Avia · Quint-Fonsegrives', init: 'AV', brand: 'Avia', cat: 'ind',
    lat: 43.5991, lng: 1.5386, address: '90 route de Castres', city: 'Quint-Fonsegrives', cp: '31130',
    h: 8, conf: 4, services: ['Gonflage'],
    prices: { gazole: 1.73, e10: 1.83, sp98: 1.93 },
  }),
  build({
    id: 'ag', name: 'Agip · Saint-Orens', init: 'AG', brand: 'Agip', cat: 'pet',
    lat: 43.5601, lng: 1.5726, address: '15 route de Revel', city: 'Saint-Orens-de-Gameville', cp: '31650',
    h: 3, conf: 9, services: ['Ouvert 24/24', 'Boutique'],
    prices: { gazole: 1.78, e10: 1.87, sp95: 1.91, sp98: 1.97, gplc: 1.05 },
  }),
  build({
    id: 'tac', name: 'Total Access · Tournefeuille', init: 'TA', brand: 'Total Access', cat: 'pet',
    lat: 43.5791, lng: 1.3836, address: '3 grande rue', city: 'Tournefeuille', cp: '31170',
    h: 1, conf: 13, services: ['Ouvert 24/24', 'Lavage', 'Boutique'],
    prices: { gazole: 1.71, e10: 1.81, sp95: 1.85, sp98: 1.91, e85: 0.85 },
  }),
  build({
    id: 'ir', name: 'Intermarché · Castelmaurou', init: 'IR', brand: 'Intermarché', cat: 'gs',
    lat: 43.6941, lng: 1.5486, address: '1 avenue de l\'Europe', city: 'Castelmaurou', cp: '31180',
    h: 5, conf: 14, services: ['Ouvert 24/24', 'Lavage', 'Boutique', 'Gonflage'],
    prices: { gazole: 1.68, e10: 1.78, sp95: 1.82, sp98: 1.88, e85: 0.85, gplc: 1.00 },
  }),
  build({
    id: 'cg', open: '07:30-21:00', name: 'Carrefour · Muret', init: 'CG', brand: 'Carrefour', cat: 'gs',
    lat: 43.4341, lng: 1.3986, address: 'ZAC Portes de Muret', city: 'Muret', cp: '31600',
    h: 7, conf: 6, services: ['Lavage', 'Boutique'],
    prices: { gazole: 1.70, e10: 1.80, sp95: 1.84, sp98: 1.90, e85: 0.86 },
  }),
];

// ── Corridor stations, placed along straight lines out of Toulouse ────────────
const DEST = {
  bordeaux: { lat: 44.8378, lng: -0.5792 },
  paris: { lat: 48.8412, lng: 2.3003 },
  montpellier: { lat: 43.6108, lng: 3.8767 },
  clermont: { lat: 45.7772, lng: 3.0870 },
} as const;

/** Point at fraction f along the Toulouse→dest straight line, nudged offKm north. */
function along(dest: GeoPoint, f: number, offKm: number): GeoPoint {
  const p = lerpPoint(TOULOUSE, dest, f);
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
  // Toulouse → Bordeaux (the design stops)
  buildRoute({
    id: 'r-grisolles', open: '07:00-21:00', name: 'Intermarché · Grisolles', init: 'IN', brand: 'Intermarché', cat: 'gs',
    dest: DEST.bordeaux, f: 0.155, off: 0.6, address: 'RD820', city: 'Grisolles', cp: '82170',
    h: 2, services: ['Boutique'], prices: { gazole: 1.71, e10: 1.81, e85: 0.86 },
  }),
  buildRoute({
    id: 'r-a62', name: 'Total Relais · A62', init: 'TO', brand: 'TotalEnergies', cat: 'pet',
    dest: DEST.bordeaux, f: 0.275, off: 0, highway: true, address: 'Aire de Garonne', city: 'Castelsarrasin', cp: '82100',
    h: 3, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.84, e10: 1.96, e85: 0.90 },
  }),
  buildRoute({
    id: 'r-valence', open: '06:30-22:00', name: 'Leclerc · Valence-d\'Agen', init: 'LE', brand: 'Leclerc', cat: 'gs',
    dest: DEST.bordeaux, f: 0.401, off: -1.0, address: 'Route d\'Agen', city: 'Valence-d\'Agen', cp: '82400',
    h: 1, services: ['Lavage', 'Boutique'], prices: { gazole: 1.66, e10: 1.76, e85: 0.84 },
  }),
  buildRoute({
    id: 'r-aiguillon', open: '07:00-21:00', name: 'Carrefour · Aiguillon', init: 'CA', brand: 'Carrefour', cat: 'gs',
    dest: DEST.bordeaux, f: 0.562, off: -4.5, address: 'RD813', city: 'Aiguillon', cp: '47190',
    h: 4, services: ['Lavage', 'Boutique'], prices: { gazole: 1.63, e10: 1.73, e85: 0.83 },
  }),
  buildRoute({
    id: 'r-langon', open: '07:00-21:30', name: 'Super U · Langon', init: 'SU', brand: 'Système U', cat: 'gs',
    dest: DEST.bordeaux, f: 0.851, off: 2.0, address: 'Route de Bordeaux', city: 'Langon', cp: '33210',
    h: 2, services: ['Boutique', 'Gonflage'], prices: { gazole: 1.73, e10: 1.83, e85: 0.87 },
  }),
  buildRoute({
    id: 'r-marmande', open: '08:00-19:30', sundayOff: true, name: 'Avia · Marmande', init: 'AV', brand: 'Avia', cat: 'ind',
    dest: DEST.bordeaux, f: 0.720, off: -3.0, address: 'RD933', city: 'Marmande', cp: '47200',
    h: 6, services: ['Gonflage'], prices: { gazole: 1.68, e10: 1.78 },
  }),

  // Toulouse → Paris
  buildRoute({
    id: 'p-cahors', name: 'Total · Cahors Sud', init: 'TO', brand: 'TotalEnergies', cat: 'pet',
    dest: DEST.paris, f: 0.150, off: 0.5, address: 'RD820', city: 'Cahors', cp: '46000',
    h: 3, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.75, e10: 1.85, e85: 0.88 },
  }),
  buildRoute({
    id: 'p-brive', name: 'Leclerc · Brive-la-Gaillarde', init: 'LE', brand: 'Leclerc', cat: 'gs',
    dest: DEST.paris, f: 0.280, off: -0.8, address: 'Avenue du Teinchurier', city: 'Brive-la-Gaillarde', cp: '19100',
    h: 2, services: ['Lavage', 'Boutique'], prices: { gazole: 1.67, e10: 1.77, e85: 0.85 },
  }),
  buildRoute({
    id: 'p-uzerche', name: 'Intermarché · Uzerche', init: 'IN', brand: 'Intermarché', cat: 'gs',
    dest: DEST.paris, f: 0.376, off: 1.2, address: 'RD920', city: 'Uzerche', cp: '19140',
    h: 5, services: ['Boutique'], prices: { gazole: 1.69, e10: 1.79 },
  }),
  buildRoute({
    id: 'p-chateauroux', name: 'Avia · Châteauroux', init: 'AV', brand: 'Avia', cat: 'ind',
    dest: DEST.paris, f: 0.580, off: -1.5, address: 'Avenue de La Châtre', city: 'Châteauroux', cp: '36000',
    h: 6, services: ['Gonflage'], prices: { gazole: 1.72, e10: 1.82 },
  }),
  buildRoute({
    id: 'p-vierzon', name: 'Carrefour · Vierzon', init: 'CA', brand: 'Carrefour', cat: 'gs',
    dest: DEST.paris, f: 0.680, off: 2.0, address: 'Avenue de Verdun', city: 'Vierzon', cp: '18100',
    h: 4, services: ['Lavage', 'Boutique'], prices: { gazole: 1.70, e10: 1.80, e85: 0.86 },
  }),
  buildRoute({
    id: 'p-orleans', name: 'Total Access · Orléans Sud', init: 'TA', brand: 'Total Access', cat: 'pet',
    dest: DEST.paris, f: 0.817, off: -1.0, address: 'A71 sortie 2', city: 'Orléans', cp: '45100',
    h: 3, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.78, e10: 1.88, e85: 0.89 },
  }),

  // Toulouse → Montpellier
  buildRoute({
    id: 'mp-salvetat', name: 'Super U · La Salvetat', init: 'SU', brand: 'Système U', cat: 'gs',
    dest: DEST.montpellier, f: 0.500, off: 0.8, address: 'Route de Lacaune', city: 'La Salvetat-sur-Agout', cp: '34330',
    h: 3, services: ['Lavage', 'Boutique'], prices: { gazole: 1.74, e10: 1.84, e85: 0.90 },
  }),
  buildRoute({
    id: 'mp-bedarieux', name: 'Total · Bédarieux', init: 'TO', brand: 'TotalEnergies', cat: 'pet',
    dest: DEST.montpellier, f: 0.700, off: -1.2, address: 'Route de Clermont', city: 'Bédarieux', cp: '34600',
    h: 2, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.79, e10: 1.89 },
  }),
  buildRoute({
    id: 'mp-clermont', name: 'Carrefour · Clermont-l\'Hérault', init: 'CA', brand: 'Carrefour', cat: 'gs',
    dest: DEST.montpellier, f: 0.780, off: 1.5, address: 'ZAC Les Tanes Basses', city: 'Clermont-l\'Hérault', cp: '34800',
    h: 5, services: ['Lavage', 'Boutique'], prices: { gazole: 1.76, e10: 1.86 },
  }),
  buildRoute({
    id: 'mp-gignac', name: 'Intermarché · Gignac', init: 'IN', brand: 'Intermarché', cat: 'gs',
    dest: DEST.montpellier, f: 0.845, off: -0.9, address: 'Route de Montpellier', city: 'Gignac', cp: '34150',
    h: 4, services: ['Boutique', 'Gonflage'], prices: { gazole: 1.71, e10: 1.81, e85: 0.86 },
  }),

  // Toulouse → Clermont-Ferrand (A20 puis A75)
  buildRoute({
    id: 'cl-villemur', name: 'Total Relais · Villemur', init: 'TO', brand: 'TotalEnergies', cat: 'pet',
    dest: DEST.clermont, f: 0.095, off: 0.6, address: 'RD14', city: 'Villemur-sur-Tarn', cp: '31340',
    h: 2, services: ['Ouvert 24/24', 'Boutique'], prices: { gazole: 1.73, e10: 1.83, e85: 0.87 },
  }),
  buildRoute({
    id: 'cl-villefranche', name: 'Leclerc · Villefranche-de-Rouergue', init: 'LE', brand: 'Leclerc', cat: 'gs',
    dest: DEST.clermont, f: 0.317, off: -1.0, address: 'Avenue de Toulouse', city: 'Villefranche-de-Rouergue', cp: '12200',
    h: 1, services: ['Lavage', 'Boutique', 'Gonflage'], prices: { gazole: 1.65, e10: 1.75, e85: 0.84 },
  }),
  buildRoute({
    id: 'cl-figeac', name: 'Carrefour · Figeac', init: 'CA', brand: 'Carrefour', cat: 'gs',
    dest: DEST.clermont, f: 0.476, off: 1.4, address: 'Route de Cahors', city: 'Figeac', cp: '46100',
    h: 5, services: ['Lavage', 'Boutique'], prices: { gazole: 1.68, e10: 1.78 },
  }),
  buildRoute({
    id: 'cl-aurillac', name: 'Avia · Aurillac', init: 'AV', brand: 'Avia', cat: 'ind',
    dest: DEST.clermont, f: 0.667, off: -1.2, address: 'RD922', city: 'Aurillac', cp: '15000',
    h: 6, services: ['Boutique'], prices: { gazole: 1.70, e10: 1.80, e85: 0.85 },
  }),
  buildRoute({
    id: 'cl-besse', name: 'Intermarché · Besse', init: 'IN', brand: 'Intermarché', cat: 'gs',
    dest: DEST.clermont, f: 0.850, off: 1.8, address: 'Route du Sancy', city: 'Besse-et-Saint-Anastaise', cp: '63610',
    h: 4, services: ['Boutique', 'Gonflage'], prices: { gazole: 1.72, e10: 1.82 },
  }),
  buildRoute({
    id: 'cl-issoire', name: 'Agip · Issoire', init: 'AG', brand: 'Agip', cat: 'pet',
    dest: DEST.clermont, f: 0.920, off: -1.0, highway: true, address: 'A75 sortie 12', city: 'Issoire', cp: '63500',
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
  { label: 'Toulouse Capitole', sublabel: 'Haute-Garonne', point: { lat: 43.6047, lng: 1.4442 } },
  { label: 'Lyon', sublabel: 'Rhône', point: { lat: 45.7640, lng: 4.8357 } },
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
