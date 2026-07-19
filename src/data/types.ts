// Data contracts — every provider (real or demo) speaks these types.
import type { GeoPoint } from '../lib/geo';
import type { StationHours } from '../lib/hours';

// ── Fuels ────────────────────────────────────────────────────────────────────
export type FuelId = 'gazole' | 'e10' | 'sp98' | 'sp95' | 'e85' | 'gplc';

export const FUEL_LABELS: Record<FuelId, string> = {
  gazole: 'Gazole',
  e10: 'SP95-E10',
  sp98: 'SP98',
  sp95: 'SP95',
  e85: 'E85',
  gplc: 'GPLc',
};

/** The three quick-switch fuels (map chip cycle + list tabs) */
export const MAIN_FUELS: FuelId[] = ['gazole', 'e10', 'e85'];
/** Every selectable fuel (filter sheet + settings) */
export const ALL_FUELS: FuelId[] = ['gazole', 'e10', 'sp98', 'sp95', 'e85', 'gplc'];

// ── Stations ─────────────────────────────────────────────────────────────────
/** Brand category used by the « Distributeurs » filter */
export type BrandCat = 'gs' | 'ind' | 'pet' | 'unknown';

/** Normalized, filterable service tags (raw services kept for the detail screen) */
export type ServiceTag = '24/24' | 'Lavage' | 'Boutique' | 'Gonflage' | 'Additifs';
export const SERVICE_TAGS: ServiceTag[] = ['24/24', 'Lavage', 'Boutique', 'Gonflage', 'Additifs'];

export interface FuelPrice {
  value: number; // €/L
  updatedAt?: string; // ISO timestamp
}

export interface Station {
  id: string;
  /** Display name, e.g. "Station U · Croix-Blanche" or "Station · Roanne" (gouv flux has no names) */
  name: string;
  /** Short initials for the avatar, e.g. "SU" */
  init: string;
  brand?: string; // "Système U", "TotalEnergies"… undefined when the source doesn't know
  cat: BrandCat;
  lat: number;
  lng: number;
  address: string;
  city: string;
  cp?: string;
  prices: Partial<Record<FuelId, FuelPrice>>;
  /** Normalized filterable tags */
  tags: ServiceTag[];
  /** Raw service labels for the detail screen */
  services: string[];
  /** true when on a motorway (gouv `pop === 'A'`) */
  highway: boolean;
  /** Opening hours when the source provides them (undefined = unknown) */
  hours?: StationHours;
  /** community confirmations (demo source only) */
  confirmations?: number;
}

/** A station enriched with position-relative info */
export interface NearbyStation extends Station {
  /** km from the user's position (displayed) */
  distKm: number;
  /** km from the search area center (drives the radius filter) */
  searchKm: number;
  driveMin: number;
}

/** A station enriched with route-relative info */
export interface RouteStation extends Station {
  kmAlong: number; // km from departure along the route
  detourMin: number; // extra minutes to reach it and come back
}

// ── Recharge électrique ──────────────────────────────────────────────────────
/** The map either compares fuel prices (€/L) or charge prices (€/kWh) —
 * two domains with different data, filters and pins, never mixed. */
export type EnergyMode = 'fuel' | 'ev';

export type ConnectorId = 't2' | 'ccs' | 'chademo' | 'ef';

export const CONNECTOR_LABELS: Record<ConnectorId, string> = {
  t2: 'Type 2',
  ccs: 'Combo CCS',
  chademo: 'CHAdeMO',
  ef: 'Prise E/F',
};

export const ALL_CONNECTORS: ConnectorId[] = ['t2', 'ccs', 'chademo', 'ef'];

/** Charging speed tiers, from the station's most powerful point */
export type PowerTier = 'lente' | 'acceleree' | 'rapide' | 'ultra';

export const TIER_LABELS: Record<PowerTier, string> = {
  lente: 'Lente',
  acceleree: 'Accélérée',
  rapide: 'Rapide',
  ultra: 'Ultra-rapide',
};

/** « Puissance min » quick-filter steps (kW) — aligned on the tier boundaries */
export const POWER_STEPS: number[] = [0, 7, 50, 150];

export function powerTier(kw: number): PowerTier {
  if (kw >= 150) return 'ultra';
  if (kw >= 50) return 'rapide';
  if (kw > 7) return 'acceleree';
  return 'lente';
}

/** Where a resolved €/kWh price comes from (shown to the user — trust differs) */
export type KwhPriceSource = 'declared' | 'grid' | 'free';

export interface KwhPrice {
  /** €/kWh TTC, ad-hoc payment (no subscription) */
  value: number;
  source: KwhPriceSource;
  /** date_maj (declared) or the grid's survey date */
  updatedAt?: string;
  /** Public pricing page backing a grid price */
  sourceUrl?: string;
}

export interface ChargeStation {
  /** id_station_itinerance, or a coordinate hash when absent */
  id: string;
  name: string;
  /** Short initials for the avatar */
  init: string;
  operator?: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
  cp?: string;
  /** Most powerful charge point of the station (kW); 0 = unknown */
  maxPowerKw: number;
  tier: PowerTier;
  pdcCount: number;
  connectors: Partial<Record<ConnectorId, number>>;
  /** Resolved ad-hoc price; absent = unknown (station still shown) */
  price?: KwhPrice;
  /** Raw `tarification` text for the detail screen when not parseable */
  pricingText?: string;
  free: boolean;
  access?: string;
  hours?: StationHours;
  pmr?: boolean;
  updatedAt?: string;
}

/** A charge station enriched with position-relative info */
export interface NearbyChargeStation extends ChargeStation {
  distKm: number;
  searchKm: number;
  driveMin: number;
}

export interface ChargeProvider {
  /** Charge stations within radiusKm of a point */
  getChargeNear(
    center: GeoPoint,
    radiusKm: number,
    opts?: StationsFetchOptions,
  ): Promise<ChargeStation[]>;
  /** Charge stations within corridorKm of a route polyline */
  getChargeAlong(polyline: GeoPoint[], corridorKm: number): Promise<ChargeStation[]>;
}

// ── Providers ────────────────────────────────────────────────────────────────
export interface SourceCapabilities {
  /** Does this source know station brands? (gouv flux does not) */
  brands: boolean;
  /** Human label shown in Réglages, e.g. "prix-carburants.gouv.fr" */
  label: string;
  /** Sub label, e.g. "temps réel · mis à jour toutes les 10 min" */
  sublabel: string;
}

export interface StationsFetchOptions {
  /** Background refresh behind an already-painted cache: hint the browser to
   * schedule the requests behind user-visible work (fetchpriority low). */
  lowPriority?: boolean;
}

export interface StationsProvider {
  readonly id: DataSourceId;
  readonly capabilities: SourceCapabilities;
  /** Stations within radiusKm of a point (any fuel). */
  getStationsNear(center: GeoPoint, radiusKm: number, opts?: StationsFetchOptions): Promise<Station[]>;
  /** Stations within corridorKm of a route polyline. */
  getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]>;
}

export interface GeocodeResult {
  label: string; // "Bordeaux centre"
  sublabel: string; // "Gironde"
  point: GeoPoint;
}

export interface GeocodeProvider {
  search(query: string): Promise<GeocodeResult[]>;
}

export interface Route {
  distanceKm: number;
  durationMin: number;
  polyline: GeoPoint[];
}

export type VehicleId = 'car' | 'moto';

export interface RouteOptions {
  avoidMotorway?: boolean;
  avoidToll?: boolean;
  vehicle?: VehicleId;
}

export interface RouteProvider {
  getRoute(from: GeoPoint, to: GeoPoint, options?: RouteOptions): Promise<Route>;
}

// ── Source selection ─────────────────────────────────────────────────────────
export type DataSourceId = 'auto' | 'fra' | 'esp' | 'demo';

export interface ProviderBundle {
  stations: StationsProvider;
  charge: ChargeProvider;
  geocode: GeocodeProvider;
  route: RouteProvider;
}
