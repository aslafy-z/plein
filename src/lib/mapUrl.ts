// Shareable map link — the map screen mirrors what it shows into the query
// string (`/?ll=43.6047,1.4442&z=14&f=diesel&r=5`): the address bar is always
// a link to the exact view on screen, and opening one lands on the same area,
// the same fuel and the same filters. Every value is re-validated on the way
// in: a link is user input, and a hand-edited one must never break the app.
import type { GeoPoint } from './geo';
import { SERVICE_TAGS, type FuelId, type ServiceTag } from '../data/types';
import { migrateFuelId } from '../state/persist';

/**
 * Fuel ids and service tags used to be French words, and links carrying them
 * are already in the wild — a shared view must keep opening on the fuel and
 * the filters it was shared with.
 */
const LEGACY_SERVICE_TAGS: Record<string, ServiceTag> = {
  '24/24': 'open24h',
  Lavage: 'carWash',
  Boutique: 'shop',
  Gonflage: 'airPump',
  Additifs: 'additives',
};

/** Query keys — short, they end up in a pasted URL */
const K = {
  center: 'll',
  zoom: 'z',
  fuel: 'f',
  radius: 'r',
  brands: 'b',
  services: 's',
} as const;

/** Zoom range the basemaps serve (see lib/tiles) */
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
/** Sanity bound on a pasted radius — the store clamps it to its own maximum */
const MAX_URL_RADIUS_KM = 100;
/** A hand-edited link can't blow the brand filter up */
const MAX_BRANDS = 40;

export interface MapUrlView {
  /** Center of the search area (the circle), not the viewport center */
  center: GeoPoint;
  /** null until Leaflet has settled on a view */
  zoom: number | null;
  fuel: FuelId;
  radius: number;
  brands: string[];
  services: ServiceTag[];
}

/** Everything the URL could say — `null` for « absent or unusable » */
export interface ParsedMapUrl {
  center: GeoPoint | null;
  zoom: number | null;
  fuel: FuelId | null;
  radius: number | null;
  brands: string[] | null;
  services: ServiceTag[] | null;
}

const EMPTY: ParsedMapUrl = {
  center: null,
  zoom: null,
  fuel: null,
  radius: null,
  brands: null,
  services: null,
};

function num(v: string | null | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function list(v: string | null): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Read a shared link. Never throws — anything unusable simply reads `null`. */
export function parseMapUrl(search: string): ParsedMapUrl {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return EMPTY;
  }

  let center: GeoPoint | null = null;
  const [rawLat, rawLng] = list(q.get(K.center));
  const lat = num(rawLat);
  const lng = num(rawLng);
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
    center = { lat, lng };

  const rawZoom = num(q.get(K.zoom));
  const zoom = rawZoom == null ? null : clamp(rawZoom, MIN_ZOOM, MAX_ZOOM);

  const fuel = migrateFuelId(q.get(K.fuel));

  const rawRadius = num(q.get(K.radius));
  const radius =
    rawRadius == null || rawRadius < 1 ? null : clamp(Math.round(rawRadius), 1, MAX_URL_RADIUS_KM);

  const brands = list(q.get(K.brands)).slice(0, MAX_BRANDS);
  const services = list(q.get(K.services))
    .map((s) => LEGACY_SERVICE_TAGS[s] ?? s)
    .filter((s): s is ServiceTag => SERVICE_TAGS.includes(s as ServiceTag));

  return {
    center,
    zoom,
    fuel,
    radius,
    brands: brands.length ? brands : null,
    services: services.length ? services : null,
  };
}

/** `?…` query describing the current map view — the shareable part of the URL */
export function mapUrlQuery(view: MapUrlView): string {
  const parts: string[] = [];
  // Commas stay literal (legal in a query) — a shared link should read like
  // coordinates, not like `%2C`
  const add = (k: string, v: string) => parts.push(`${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`);
  const round = (n: number, d: number) => String(Number(n.toFixed(d)));

  // ~1 m of precision is plenty, and keeps the link short
  add(K.center, `${round(view.center.lat, 5)},${round(view.center.lng, 5)}`);
  if (view.zoom != null) add(K.zoom, round(view.zoom, 2));
  // Fuel and radius are always written: the recipient must see the shared
  // view, not the one their own persisted settings would produce
  add(K.fuel, view.fuel);
  add(K.radius, String(view.radius));
  if (view.brands.length) add(K.brands, view.brands.join(','));
  if (view.services.length) add(K.services, view.services.join(','));
  return `?${parts.join('&')}`;
}
