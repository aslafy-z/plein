// Offline, deterministic demo dataset — realistic France, centred on Toulouse.
// All coordinates are plausible-but-approximate; the demo route provider draws
// straight lines, so corridor stations are placed along those lines (with a
// generous tolerance in DemoStationsProvider) rather than at exact city points.
import type { GeoPoint } from '../../lib/geo';
import { lerpPoint } from '../../lib/geo';
import type { DayHours, StationHours } from '../../lib/hours';
import {
  SERVICE_TAGS,
  type ExtraProductId,
  type FuelId,
  type FuelPrice,
  type ServiceTag,
  type Station,
} from '../types';

// ── Shared helpers ───────────────────────────────────────────────────────────
const NOW = Date.now();
const TOULOUSE: GeoPoint = { lat: 43.6047, lng: 1.4442 };

function hoursAgo(h: number): string {
  return new Date(NOW - h * 3_600_000).toISOString();
}

/**
 * Filter tags of a demo station. Unlike the real fluxes — which hand us free
 * text in the source's own language — the fixture speaks the app's own service
 * ids, so the tags ARE the services.
 */
export function tagsFromServices(services: string[]): ServiceTag[] {
  return SERVICE_TAGS.filter((t) => services.includes(t));
}

interface StationSpec {
  id: string;
  name: string;
  init: string;
  brand: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
  postalCode: string;
  h: number; // hours since last update
  highway?: boolean;
  services: string[];
  prices: Partial<Record<FuelId, number>>;
  /** Extra products the source prices, like the Spanish and Andorran fluxes do */
  extraPrices?: Partial<Record<ExtraProductId, number>>;
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
  if (spec.services.includes('open24h')) return { auto24: true, days: {} };
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
  const extraPrices: Partial<Record<ExtraProductId, FuelPrice>> = {};
  (Object.keys(spec.extraPrices ?? {}) as ExtraProductId[]).forEach((p) => {
    const value = spec.extraPrices?.[p];
    if (value != null) extraPrices[p] = { value, updatedAt };
  });
  return {
    id: spec.id,
    name: spec.name,
    init: spec.init,
    brand: spec.brand,
    lat: spec.lat,
    lng: spec.lng,
    address: spec.address,
    city: spec.city,
    postalCode: spec.postalCode,
    prices,
    tags: tagsFromServices(spec.services),
    services: spec.services,
    extraPrices,
    highway: spec.highway ?? false,
    hours: hoursFromSpec(spec),
  };
}

// ── Stations around Toulouse Capitole (radius slider matters: 0.6 → ~19 km) ───
export const DEMO_STATIONS: Station[] = [
  // The six stations from the design prototype (exact names / prices / services)
  build({
    id: 'su', name: 'Station U · Croix-Blanche', init: 'SU', brand: 'Système U',
    lat: 43.6101, lng: 1.4519, address: '12 route de la Croix-Blanche', city: 'Toulouse', postalCode: '31000',
    h: 2, services: ['open24h', 'carWash', 'shop', 'airPump'],
    prices: { diesel: 1.67, e10: 1.78, e85: 0.84, unleaded95: 1.82, unleaded98: 1.88 },
  }),
  build({
    id: 'in', name: 'Intermarché · Les Vignes', init: 'IN', brand: 'Intermarché',
    lat: 43.6191, lng: 1.4586, address: '45 avenue des Vignes', city: 'Toulouse', postalCode: '31200',
    h: 3, services: ['open24h', 'carWash'],
    prices: { diesel: 1.69, e10: 1.79, e85: 0.86, unleaded95: 1.83, unleaded98: 1.89 },
  }),
  build({
    id: 'ca', open: '07:00-21:30', name: 'Carrefour Market', init: 'CA', brand: 'Carrefour',
    lat: 43.5891, lng: 1.4236, address: '2 rue du Marché', city: 'Toulouse', postalCode: '31300',
    h: 26, services: ['shop'],
    prices: { diesel: 1.74, e10: 1.84, e85: 0.88, unleaded95: 1.88, unleaded98: 1.94 },
  }),
  build({
    id: 'mo', open: '08:00-19:00', sundayOff: true, name: 'Garage Morel', init: 'GM', brand: 'Indépendant',
    lat: 43.5821, lng: 1.4686, address: '8 rue Morel', city: 'Toulouse', postalCode: '31400',
    h: 28, services: ['airPump'],
    prices: { diesel: 1.72, e10: 1.83 },
  }),
  build({
    id: 'te', name: 'TotalEnergies · Centre', init: 'TE', brand: 'TotalEnergies',
    lat: 43.6001, lng: 1.4386, address: '1 allée Jules-Guesde', city: 'Toulouse', postalCode: '31000',
    h: 1, services: ['open24h', 'carWash', 'shop', 'airPump', 'additives', 'adBlue'],
    prices: { diesel: 1.82, e10: 1.89, e85: 0.89, unleaded95: 1.93, unleaded98: 1.99 },
  }),
  build({
    id: 'bp', name: 'BP · Rocade Est', init: 'BP', brand: 'BP',
    lat: 43.6241, lng: 1.4886, address: 'Rocade Est', city: 'Toulouse', postalCode: '31500',
    // The only demo station to price its AdBlue — the Spanish and Andorran
    // fluxes do, the French and Portuguese ones never do
    h: 5, services: ['open24h', 'shop', 'additives', 'adBlue'],
    prices: { diesel: 1.80, e10: 1.88, unleaded95: 1.92, unleaded98: 1.98 },
    extraPrices: { adBlue: 0.89 },
  }),
  // Eight more, spread 3–19 km out, all six fuels represented across the set
  build({
    id: 'es', name: 'Esso Express · L\'Union', init: 'ES', brand: 'Esso',
    lat: 43.6341, lng: 1.5086, address: '210 route d\'Albi', city: 'L\'Union', postalCode: '31240',
    // Free upstream text alongside the ids — the fiche must pass it through
    h: 4, services: ['open24h', 'shop', 'additives', "Vente d'additifs carburants"],
    prices: { diesel: 1.79, e10: 1.85, unleaded95: 1.89, unleaded98: 1.95, e85: 0.87, lpg: 1.02 },
  }),
  build({
    id: 'le', open: '06:30-22:00', name: 'E.Leclerc · Labège', init: 'EL', brand: 'Leclerc',
    lat: 43.5611, lng: 1.5136, address: '5 avenue de l\'Occitanie', city: 'Labège', postalCode: '31670',
    h: 2, services: ['carWash', 'shop', 'airPump'],
    prices: { diesel: 1.65, e10: 1.75, unleaded95: 1.79, unleaded98: 1.85, e85: 0.83, lpg: 0.99 },
  }),
  build({
    id: 'au', open: '07:00-21:00', name: 'Auchan · Launaguet', init: 'AU', brand: 'Auchan',
    lat: 43.6591, lng: 1.4686, address: '2 rue Pasteur', city: 'Launaguet', postalCode: '31140',
    h: 6, services: ['carWash', 'shop'],
    prices: { diesel: 1.66, e10: 1.76, unleaded95: 1.80, unleaded98: 1.86, e85: 0.84 },
  }),
  build({
    id: 'av', name: 'Avia · Quint-Fonsegrives', init: 'AV', brand: 'Avia',
    lat: 43.5991, lng: 1.5386, address: '90 route de Castres', city: 'Quint-Fonsegrives', postalCode: '31130',
    h: 8, services: ['airPump'],
    prices: { diesel: 1.73, e10: 1.83, unleaded98: 1.93 },
  }),
  build({
    id: 'ag', name: 'Agip · Saint-Orens', init: 'AG', brand: 'Agip',
    lat: 43.5601, lng: 1.5726, address: '15 route de Revel', city: 'Saint-Orens-de-Gameville', postalCode: '31650',
    h: 3, services: ['open24h', 'shop'],
    prices: { diesel: 1.78, e10: 1.87, unleaded95: 1.91, unleaded98: 1.97, lpg: 1.05 },
  }),
  build({
    id: 'tac', name: 'Total Access · Tournefeuille', init: 'TA', brand: 'Total Access',
    lat: 43.5791, lng: 1.3836, address: '3 grande rue', city: 'Tournefeuille', postalCode: '31170',
    h: 1, services: ['open24h', 'carWash', 'shop'],
    prices: { diesel: 1.71, e10: 1.81, unleaded95: 1.85, unleaded98: 1.91, e85: 0.85 },
  }),
  build({
    id: 'ir', name: 'Intermarché · Castelmaurou', init: 'IR', brand: 'Intermarché',
    lat: 43.6941, lng: 1.5486, address: '1 avenue de l\'Europe', city: 'Castelmaurou', postalCode: '31180',
    h: 5, services: ['open24h', 'carWash', 'shop', 'airPump'],
    prices: { diesel: 1.68, e10: 1.78, unleaded95: 1.82, unleaded98: 1.88, e85: 0.85, lpg: 1.00 },
  }),
  build({
    id: 'cg', open: '07:30-21:00', name: 'Carrefour · Muret', init: 'CG', brand: 'Carrefour',
    lat: 43.4341, lng: 1.3986, address: 'ZAC Portes de Muret', city: 'Muret', postalCode: '31600',
    h: 7, services: ['carWash', 'shop'],
    prices: { diesel: 1.70, e10: 1.80, unleaded95: 1.84, unleaded98: 1.90, e85: 0.86 },
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
    id: 'r-grisolles', open: '07:00-21:00', name: 'Intermarché · Grisolles', init: 'IN', brand: 'Intermarché',
    dest: DEST.bordeaux, f: 0.155, off: 0.6, address: 'RD820', city: 'Grisolles', postalCode: '82170',
    h: 2, services: ['shop'], prices: { diesel: 1.71, e10: 1.81, e85: 0.86 },
  }),
  buildRoute({
    id: 'r-a62', name: 'Total Relais · A62', init: 'TO', brand: 'TotalEnergies',
    dest: DEST.bordeaux, f: 0.275, off: 0, highway: true, address: 'Aire de Garonne', city: 'Castelsarrasin', postalCode: '82100',
    h: 3, services: ['open24h', 'shop'], prices: { diesel: 1.84, e10: 1.96, e85: 0.90 },
  }),
  buildRoute({
    id: 'r-valence', open: '06:30-22:00', name: 'Leclerc · Valence-d\'Agen', init: 'LE', brand: 'Leclerc',
    dest: DEST.bordeaux, f: 0.401, off: -1.0, address: 'Route d\'Agen', city: 'Valence-d\'Agen', postalCode: '82400',
    h: 1, services: ['carWash', 'shop'], prices: { diesel: 1.66, e10: 1.76, e85: 0.84 },
  }),
  buildRoute({
    id: 'r-aiguillon', open: '07:00-21:00', name: 'Carrefour · Aiguillon', init: 'CA', brand: 'Carrefour',
    dest: DEST.bordeaux, f: 0.562, off: -4.5, address: 'RD813', city: 'Aiguillon', postalCode: '47190',
    h: 4, services: ['carWash', 'shop'], prices: { diesel: 1.63, e10: 1.73, e85: 0.83 },
  }),
  buildRoute({
    id: 'r-langon', open: '07:00-21:30', name: 'Super U · Langon', init: 'SU', brand: 'Système U',
    dest: DEST.bordeaux, f: 0.851, off: 2.0, address: 'Route de Bordeaux', city: 'Langon', postalCode: '33210',
    h: 2, services: ['shop', 'airPump'], prices: { diesel: 1.73, e10: 1.83, e85: 0.87 },
  }),
  buildRoute({
    id: 'r-marmande', open: '08:00-19:30', sundayOff: true, name: 'Avia · Marmande', init: 'AV', brand: 'Avia',
    dest: DEST.bordeaux, f: 0.720, off: -3.0, address: 'RD933', city: 'Marmande', postalCode: '47200',
    h: 6, services: ['airPump'], prices: { diesel: 1.68, e10: 1.78 },
  }),

  // Toulouse → Paris
  buildRoute({
    id: 'p-cahors', name: 'Total · Cahors Sud', init: 'TO', brand: 'TotalEnergies',
    dest: DEST.paris, f: 0.150, off: 0.5, address: 'RD820', city: 'Cahors', postalCode: '46000',
    h: 3, services: ['open24h', 'shop'], prices: { diesel: 1.75, e10: 1.85, e85: 0.88 },
  }),
  buildRoute({
    id: 'p-brive', name: 'Leclerc · Brive-la-Gaillarde', init: 'LE', brand: 'Leclerc',
    dest: DEST.paris, f: 0.280, off: -0.8, address: 'Avenue du Teinchurier', city: 'Brive-la-Gaillarde', postalCode: '19100',
    h: 2, services: ['carWash', 'shop'], prices: { diesel: 1.67, e10: 1.77, e85: 0.85 },
  }),
  buildRoute({
    id: 'p-uzerche', name: 'Intermarché · Uzerche', init: 'IN', brand: 'Intermarché',
    dest: DEST.paris, f: 0.376, off: 1.2, address: 'RD920', city: 'Uzerche', postalCode: '19140',
    h: 5, services: ['shop'], prices: { diesel: 1.69, e10: 1.79 },
  }),
  buildRoute({
    id: 'p-chateauroux', name: 'Avia · Châteauroux', init: 'AV', brand: 'Avia',
    dest: DEST.paris, f: 0.580, off: -1.5, address: 'Avenue de La Châtre', city: 'Châteauroux', postalCode: '36000',
    h: 6, services: ['airPump'], prices: { diesel: 1.72, e10: 1.82 },
  }),
  buildRoute({
    id: 'p-vierzon', name: 'Carrefour · Vierzon', init: 'CA', brand: 'Carrefour',
    dest: DEST.paris, f: 0.680, off: 2.0, address: 'Avenue de Verdun', city: 'Vierzon', postalCode: '18100',
    h: 4, services: ['carWash', 'shop'], prices: { diesel: 1.70, e10: 1.80, e85: 0.86 },
  }),
  buildRoute({
    id: 'p-orleans', name: 'Total Access · Orléans Sud', init: 'TA', brand: 'Total Access',
    dest: DEST.paris, f: 0.817, off: -1.0, address: 'A71 sortie 2', city: 'Orléans', postalCode: '45100',
    h: 3, services: ['open24h', 'shop'], prices: { diesel: 1.78, e10: 1.88, e85: 0.89 },
  }),

  // Toulouse → Montpellier
  buildRoute({
    id: 'mp-salvetat', name: 'Super U · La Salvetat', init: 'SU', brand: 'Système U',
    dest: DEST.montpellier, f: 0.500, off: 0.8, address: 'Route de Lacaune', city: 'La Salvetat-sur-Agout', postalCode: '34330',
    h: 3, services: ['carWash', 'shop'], prices: { diesel: 1.74, e10: 1.84, e85: 0.90 },
  }),
  buildRoute({
    id: 'mp-bedarieux', name: 'Total · Bédarieux', init: 'TO', brand: 'TotalEnergies',
    dest: DEST.montpellier, f: 0.700, off: -1.2, address: 'Route de Clermont', city: 'Bédarieux', postalCode: '34600',
    h: 2, services: ['open24h', 'shop'], prices: { diesel: 1.79, e10: 1.89 },
  }),
  buildRoute({
    id: 'mp-clermont', name: 'Carrefour · Clermont-l\'Hérault', init: 'CA', brand: 'Carrefour',
    dest: DEST.montpellier, f: 0.780, off: 1.5, address: 'ZAC Les Tanes Basses', city: 'Clermont-l\'Hérault', postalCode: '34800',
    h: 5, services: ['carWash', 'shop'], prices: { diesel: 1.76, e10: 1.86 },
  }),
  buildRoute({
    id: 'mp-gignac', name: 'Intermarché · Gignac', init: 'IN', brand: 'Intermarché',
    dest: DEST.montpellier, f: 0.845, off: -0.9, address: 'Route de Montpellier', city: 'Gignac', postalCode: '34150',
    h: 4, services: ['shop', 'airPump'], prices: { diesel: 1.71, e10: 1.81, e85: 0.86 },
  }),

  // Toulouse → Clermont-Ferrand (A20 then A75)
  buildRoute({
    id: 'cl-villemur', name: 'Total Relais · Villemur', init: 'TO', brand: 'TotalEnergies',
    dest: DEST.clermont, f: 0.095, off: 0.6, address: 'RD14', city: 'Villemur-sur-Tarn', postalCode: '31340',
    h: 2, services: ['open24h', 'shop'], prices: { diesel: 1.73, e10: 1.83, e85: 0.87 },
  }),
  buildRoute({
    id: 'cl-villefranche', name: 'Leclerc · Villefranche-de-Rouergue', init: 'LE', brand: 'Leclerc',
    dest: DEST.clermont, f: 0.317, off: -1.0, address: 'Avenue de Toulouse', city: 'Villefranche-de-Rouergue', postalCode: '12200',
    h: 1, services: ['carWash', 'shop', 'airPump'], prices: { diesel: 1.65, e10: 1.75, e85: 0.84 },
  }),
  buildRoute({
    id: 'cl-figeac', name: 'Carrefour · Figeac', init: 'CA', brand: 'Carrefour',
    dest: DEST.clermont, f: 0.476, off: 1.4, address: 'Route de Cahors', city: 'Figeac', postalCode: '46100',
    h: 5, services: ['carWash', 'shop'], prices: { diesel: 1.68, e10: 1.78 },
  }),
  buildRoute({
    id: 'cl-aurillac', name: 'Avia · Aurillac', init: 'AV', brand: 'Avia',
    dest: DEST.clermont, f: 0.667, off: -1.2, address: 'RD922', city: 'Aurillac', postalCode: '15000',
    h: 6, services: ['shop'], prices: { diesel: 1.70, e10: 1.80, e85: 0.85 },
  }),
  buildRoute({
    id: 'cl-besse', name: 'Intermarché · Besse', init: 'IN', brand: 'Intermarché',
    dest: DEST.clermont, f: 0.850, off: 1.8, address: 'Route du Sancy', city: 'Besse-et-Saint-Anastaise', postalCode: '63610',
    h: 4, services: ['shop', 'airPump'], prices: { diesel: 1.72, e10: 1.82 },
  }),
  buildRoute({
    id: 'cl-issoire', name: 'Agip · Issoire', init: 'AG', brand: 'Agip',
    dest: DEST.clermont, f: 0.920, off: -1.0, highway: true, address: 'A75 sortie 12', city: 'Issoire', postalCode: '63500',
    h: 3, services: ['open24h', 'shop'], prices: { diesel: 1.81, e10: 1.91 },
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
