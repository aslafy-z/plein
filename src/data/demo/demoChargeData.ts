// Offline, deterministic demo charge stations — same fictional Toulouse area
// as the fuel set, with every price provenance represented (grid / declared /
// free / unknown) so the EV mode UI can be exercised end-to-end offline.
import { powerTier, type ChargeStation } from '../types';

const NOW = Date.now();

function daysAgo(d: number): string {
  return new Date(NOW - d * 86_400_000).toISOString();
}

interface ChargeSpec {
  id: string;
  name: string;
  init: string;
  operator: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
  cp: string;
  kw: number;
  pdc: number;
  connectors: ChargeStation['connectors'];
  /** €/kWh + provenance; absent = unknown price */
  price?: { value: number; source: 'declared' | 'grid' | 'free'; days: number; url?: string };
  pricingText?: string;
  free?: boolean;
  auto24?: boolean;
}

const SPECS: ChargeSpec[] = [
  {
    id: 'FRDEMOP001', name: 'Superchargeur · Toulouse Nord', init: 'TS', operator: 'Tesla',
    lat: 43.6293, lng: 1.4351, address: '2 av. des États-Unis', city: 'Toulouse', cp: '31200',
    kw: 250, pdc: 16, connectors: { ccs: 16 },
    price: { value: 0.4, source: 'grid', days: 12, url: 'https://www.tesla.com/fr_fr/supercharger' },
    auto24: true,
  },
  {
    id: 'FRDEMOP002', name: 'Electra · Compans-Caffarelli', init: 'EL', operator: 'Electra',
    lat: 43.611, lng: 1.4344, address: 'bd Lascrosses', city: 'Toulouse', cp: '31000',
    kw: 150, pdc: 6, connectors: { ccs: 6 },
    price: { value: 0.49, source: 'grid', days: 12, url: 'https://www.go-electra.com/fr/' },
    auto24: true,
  },
  {
    id: 'FRDEMOP003', name: 'Réseau Métropole · Capitole', init: 'RM', operator: 'Toulouse Métropole',
    lat: 43.6045, lng: 1.4415, address: 'pl. du Capitole', city: 'Toulouse', cp: '31000',
    kw: 22, pdc: 4, connectors: { t2: 4, ef: 2 },
    price: { value: 0.35, source: 'declared', days: 3 },
    pricingText: '0,35 € TTC / kWh',
    auto24: true,
  },
  {
    id: 'FRDEMOP004', name: 'Parking Carmes · Recharge', init: 'PC', operator: 'Toulouse Métropole',
    lat: 43.5972, lng: 1.4457, address: 'pl. des Carmes', city: 'Toulouse', cp: '31000',
    kw: 7.4, pdc: 6, connectors: { t2: 6 },
    price: { value: 0, source: 'free', days: 8 }, free: true,
  },
  {
    id: 'FRDEMOP005', name: 'Ionity · Aire du Sud-Ouest', init: 'IO', operator: 'Ionity',
    lat: 43.5601, lng: 1.4008, address: 'A64 · aire de service', city: 'Portet-sur-Garonne', cp: '31120',
    kw: 350, pdc: 8, connectors: { ccs: 8 },
    price: { value: 0.59, source: 'grid', days: 12, url: 'https://ionity.eu/fr/reseau-et-tarifs' },
    auto24: true,
  },
  {
    id: 'FRDEMOP006', name: 'Supermarché · Purpan', init: 'SP', operator: 'Power Dot',
    lat: 43.6118, lng: 1.4033, address: 'route de Bayonne', city: 'Toulouse', cp: '31300',
    kw: 100, pdc: 4, connectors: { ccs: 3, chademo: 1 },
    price: { value: 0.44, source: 'grid', days: 12, url: 'https://powerdot.fr' },
  },
  {
    id: 'FRDEMOP007', name: 'Borne communale · Balma', init: 'BC', operator: 'SDEHG',
    lat: 43.6111, lng: 1.4995, address: 'av. des Arènes', city: 'Balma', cp: '31130',
    kw: 22, pdc: 2, connectors: { t2: 2 },
    price: { value: 0.28, source: 'declared', days: 20 },
    pricingText: '0,28 € / kWh + 0,02 €/min au-delà de 2 h',
  },
  {
    id: 'FRDEMOP008', name: 'Hôtel du Canal · Ramonville', init: 'HC', operator: 'Indépendant',
    lat: 43.5471, lng: 1.4759, address: 'port Sud', city: 'Ramonville-Saint-Agne', cp: '31520',
    kw: 11, pdc: 2, connectors: { t2: 2 },
    pricingText: 'Tarif affiché à la borne',
  },
  {
    id: 'FRDEMOP009', name: 'Fastned · Toulouse Ouest', init: 'FN', operator: 'Fastned',
    lat: 43.5946, lng: 1.3701, address: 'ZAC du Perget', city: 'Colomiers', cp: '31770',
    kw: 300, pdc: 8, connectors: { ccs: 8 },
    price: { value: 0.59, source: 'grid', days: 12, url: 'https://www.fastned.nl/fr/tarifs' },
    auto24: true,
  },
  {
    id: 'FRDEMOP010', name: 'Zone commerciale · Labège', init: 'ZC', operator: 'Driveco',
    lat: 43.5502, lng: 1.5133, address: 'rue du Commerce', city: 'Labège', cp: '31670',
    kw: 50, pdc: 4, connectors: { ccs: 2, t2: 2 },
    price: { value: 0.45, source: 'grid', days: 12, url: 'https://driveco.com' },
  },
];

function build(spec: ChargeSpec): ChargeStation {
  return {
    id: spec.id,
    name: spec.name,
    init: spec.init,
    operator: spec.operator,
    lat: spec.lat,
    lng: spec.lng,
    address: spec.address,
    city: spec.city,
    cp: spec.cp,
    maxPowerKw: spec.kw,
    tier: powerTier(spec.kw),
    pdcCount: spec.pdc,
    connectors: spec.connectors,
    price: spec.price
      ? {
          value: spec.price.value,
          source: spec.price.source,
          updatedAt: daysAgo(spec.price.days),
          sourceUrl: spec.price.url,
        }
      : undefined,
    pricingText: spec.pricingText,
    free: spec.free ?? false,
    hours: spec.auto24 ? { auto24: true, days: {} } : undefined,
    updatedAt: daysAgo(spec.price?.days ?? 15),
  };
}

export const DEMO_CHARGE_STATIONS: ChargeStation[] = SPECS.map(build);
