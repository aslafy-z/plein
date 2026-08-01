// Shareable route link — the route screen mirrors the trip into the query
// string the way the map mirrors its view (`mapUrl.ts`): the address bar is
// always a link to the trip on screen, and opening one recomputes the same
// route under the same fuel and vehicle assumptions, whatever the reader's
// own persisted settings say. Every value is re-validated on the way in: a
// link is user input, and a hand-edited one must never break the app.
//
// The setup form lives on `/route`, the computed ribbon on `/route/results` —
// the path alone rebuilds the right screen, so a departure shared as « Ma
// position » (whose link carries no coordinates on purpose) still reopens on
// the ribbon.
import type { GeoPoint } from './geo';
import type { FuelId, VehicleId } from '../data/types';
import { migrateFuelId, migrateVehicleId } from '../state/persist';

/** Strategy toggle of the ribbon — mirrors `RouteMode` in the store */
export type RouteUrlMode = 'balanced' | 'price' | 'detour';

/** Query keys — short, they end up in a pasted URL */
const K = {
  from: 'a',
  fromLabel: 'al',
  to: 'd',
  toLabel: 'dl',
  fuel: 'f',
  mode: 'm',
  vehicle: 'v',
  tank: 't',
  consumption: 'c',
  startTankPct: 'tp',
  avoid: 'x',
} as const;

const MODES: RouteUrlMode[] = ['balanced', 'price', 'detour'];

/** Long place labels make long URLs — cap them the way `MAX_BRANDS` caps the
 *  brand filter. Geocoder labels are far shorter; only a hand-edited link hits it. */
const MAX_LABEL_LEN = 120;
/** Sanity bounds — the union of what the Réglages sliders can set */
const TANK_RANGE = { min: 5, max: 80 };
const CONSUMPTION_RANGE = { min: 3, max: 12 };
const START_TANK_RANGE = { min: 10, max: 100 };

export interface RouteUrlView {
  /** null while the departure means « Ma position » or is not yet resolved */
  fromPoint: GeoPoint | null;
  /** Empty when the departure is « Ma position » (the flag below carries it) */
  fromLabel: string;
  /** Sharing a « Ma position » departure must not leak where the sender was:
   *  the link then carries neither coordinates nor label for the departure. */
  fromIsCurrentPosition: boolean;
  toPoint: GeoPoint | null;
  toLabel: string;
  fuel: FuelId;
  mode: RouteUrlMode;
  vehicle: VehicleId;
  tank: number;
  consumption: number;
  startTankPct: number;
  avoidMotorway: boolean;
  avoidToll: boolean;
}

/** Everything the URL could say — `null` for « absent or unusable » */
export interface ParsedRouteUrl {
  fromPoint: GeoPoint | null;
  fromLabel: string | null;
  toPoint: GeoPoint | null;
  toLabel: string | null;
  fuel: FuelId | null;
  mode: RouteUrlMode | null;
  vehicle: VehicleId | null;
  tank: number | null;
  consumption: number | null;
  startTankPct: number | null;
  /** null when the link says nothing about avoids (`x` absent) */
  avoidMotorway: boolean | null;
  avoidToll: boolean | null;
}

const EMPTY: ParsedRouteUrl = {
  fromPoint: null,
  fromLabel: null,
  toPoint: null,
  toLabel: null,
  fuel: null,
  mode: null,
  vehicle: null,
  tank: null,
  consumption: null,
  startTankPct: null,
  avoidMotorway: null,
  avoidToll: null,
};

function num(v: string | null | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function point(v: string | null): GeoPoint | null {
  const [rawLat, rawLng] = (v ?? '').split(',').map((s) => s.trim());
  const lat = num(rawLat);
  const lng = num(rawLng);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function label(v: string | null): string | null {
  const trimmed = (v ?? '').trim().slice(0, MAX_LABEL_LEN);
  return trimmed === '' ? null : trimmed;
}

/** Read a shared link. Never throws — anything unusable simply reads `null`. */
export function parseRouteUrl(search: string): ParsedRouteUrl {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return EMPTY;
  }

  const fromPoint = point(q.get(K.from));
  // A departure label without coordinates geocodes on open — but a label for
  // a departure the link never named would be words with nothing behind them.
  const fromLabel = label(q.get(K.fromLabel));
  const toPoint = point(q.get(K.to));
  const toLabel = label(q.get(K.toLabel));

  const fuel = migrateFuelId(q.get(K.fuel));
  const rawMode = q.get(K.mode);
  const mode = MODES.includes(rawMode as RouteUrlMode) ? (rawMode as RouteUrlMode) : null;
  const vehicle = migrateVehicleId(q.get(K.vehicle));

  const rawTank = num(q.get(K.tank));
  const tank = rawTank == null ? null : Math.round(clamp(rawTank, TANK_RANGE.min, TANK_RANGE.max));
  const rawConsumption = num(q.get(K.consumption));
  const consumption =
    rawConsumption == null
      ? null
      : Number(clamp(rawConsumption, CONSUMPTION_RANGE.min, CONSUMPTION_RANGE.max).toFixed(1));
  const rawStartTank = num(q.get(K.startTankPct));
  const startTankPct =
    rawStartTank == null
      ? null
      : Math.round(clamp(rawStartTank, START_TANK_RANGE.min, START_TANK_RANGE.max));

  // `x` absent → the link says nothing; `x` present → the flags it lists are
  // on and the others OFF, so a shared trip never inherits the reader's avoids
  const rawAvoid = q.get(K.avoid);
  const avoid =
    rawAvoid == null
      ? null
      : new Set(rawAvoid.split(',').map((s) => s.trim()).filter(Boolean));

  return {
    fromPoint,
    fromLabel,
    toPoint,
    toLabel,
    fuel,
    mode,
    vehicle,
    tank,
    consumption,
    startTankPct,
    avoidMotorway: avoid == null ? null : avoid.has('motorway'),
    avoidToll: avoid == null ? null : avoid.has('toll'),
  };
}

/**
 * `?…` query describing the trip — the shareable part of the URL. Returns ''
 * while nothing trip-specific is set (no endpoint touched): a bare `/route`
 * bookmark keeps opening a bare setup form instead of freezing the sender's
 * defaults into every copy of the address bar.
 */
export function routeUrlQuery(view: RouteUrlView): string {
  const hasFrom = !view.fromIsCurrentPosition && (view.fromPoint != null || view.fromLabel.trim() !== '');
  const hasTo = view.toPoint != null || view.toLabel.trim() !== '';
  if (!hasFrom && !hasTo) return '';

  const parts: string[] = [];
  // Commas stay literal (legal in a query) — a shared link should read like
  // coordinates, not like `%2C`
  const add = (k: string, v: string) =>
    parts.push(`${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`);
  const round = (n: number, d: number) => String(Number(n.toFixed(d)));
  // ~1 m of precision is plenty, and keeps the link short
  const coord = (p: GeoPoint) => `${round(p.lat, 5)},${round(p.lng, 5)}`;

  // « Ma position » writes NO departure at all — the flag would otherwise
  // leak the sender's position into every shared trip
  if (hasFrom) {
    if (view.fromPoint) add(K.from, coord(view.fromPoint));
    if (view.fromLabel.trim()) add(K.fromLabel, view.fromLabel.trim().slice(0, MAX_LABEL_LEN));
  }
  if (view.toPoint) add(K.to, coord(view.toPoint));
  if (view.toLabel.trim()) add(K.toLabel, view.toLabel.trim().slice(0, MAX_LABEL_LEN));

  // The trip's assumptions are always written: the recipient must see the
  // shared trip, not the one their own persisted settings would produce
  add(K.fuel, view.fuel);
  add(K.mode, view.mode);
  add(K.vehicle, view.vehicle);
  add(K.tank, round(view.tank, 0));
  add(K.consumption, round(view.consumption, 1));
  add(K.startTankPct, round(view.startTankPct, 0));
  const avoid = [view.avoidMotorway ? 'motorway' : null, view.avoidToll ? 'toll' : null]
    .filter(Boolean)
    .join(',');
  if (avoid) add(K.avoid, avoid);

  return `?${parts.join('&')}`;
}

/**
 * Which route screen a link lands on. The ribbon path asks for the results
 * and gets them as long as a destination is resolvable; a plain `/route`
 * whose query nonetheless spells a complete trip (both endpoints) also lands
 * on the ribbon, since the query fully specifies it. Everything less —
 * a destination and no departure, a truncated query, no query at all —
 * degrades to the setup form, pre-filled with whatever is usable.
 */
export function routeScreenFromUrl(
  ribbonPath: boolean,
  parsed: ParsedRouteUrl,
): 'route' | 'routeSetup' {
  const hasTo = parsed.toPoint != null || parsed.toLabel != null;
  if (ribbonPath) return hasTo ? 'route' : 'routeSetup';
  const hasFrom = parsed.fromPoint != null || parsed.fromLabel != null;
  return hasTo && hasFrom ? 'route' : 'routeSetup';
}

/** What an endpoint carrying coordinates but no label displays as */
export function coordinateLabel(p: GeoPoint): string {
  const round = (n: number) => String(Number(n.toFixed(5)));
  return `${round(p.lat)}, ${round(p.lng)}`;
}
