// Staged route pipeline — the state a route computation moves through, and the
// pure transitions between stages.
//
// A route is built in two stages: the geometry (distance, duration, polyline)
// and then the stations in its corridor. Modelling them separately is what lets
// the itinerary and the map show up before any station is known, lets a stage
// fail and be retried on its own, and lets the previous result stay on screen
// while a new one computes instead of being blanked.
//
// Every transition is guarded by the input signature it was started for, so a
// slow answer for endpoints the user has since edited can never overwrite a
// newer result. The store additionally guards on a generation counter, which
// distinguishes two runs that share the same signature (a stage retried twice).
import type { Route, RouteStation } from '../data/types';
import type { GeoPoint } from '../lib/geo';

export type StageStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The endpoints as the user named them, carried with the result they produced */
export interface RouteEndpoints {
  from: string;
  to: string;
}

export interface RouteState {
  /** Last known geometry — kept on screen while a newer one computes or fails */
  route: Route | null;
  /**
   * Labels `route` was computed for. They travel with the geometry so a stale
   * result is never relabelled with the endpoints of the trip being computed:
   * « Lyon → Annecy · 543 km » would be a distance that belongs to neither.
   */
  endpoints: RouteEndpoints;
  /** Corridor stops placed along `route` */
  stations: RouteStation[];
  geometry: StageStatus;
  corridor: StageStatus;
  /** Signature of the inputs `route` / `stations` were computed for */
  key: string | null;
  /** Signature of the computation currently in flight */
  pendingKey: string | null;
  /** true while `route` / `stations` belong to an older, still-displayed key */
  provisional: boolean;
  geometryError?: string;
  corridorError?: string;
}

export const initialRouteState: RouteState = {
  route: null,
  endpoints: { from: '', to: '' },
  stations: [],
  geometry: 'idle',
  corridor: 'idle',
  key: null,
  pendingKey: null,
  provisional: false,
};

/** Everything that changes what the routing engine would answer */
export interface RouteInputs {
  source: string;
  avoidMotorway: boolean;
  avoidToll: boolean;
  vehicle: string;
}

/**
 * Signature of the inputs a route is computed for: both endpoints rounded to
 * ~11 m, plus the source and the routing options — the same endpoints under
 * « éviter les péages » are a different result.
 */
export function routeKey(from: GeoPoint, to: GeoPoint, inputs: RouteInputs): string {
  const r = (n: number) => n.toFixed(4);
  const opts = `${inputs.source}/${inputs.vehicle}/${inputs.avoidMotorway ? 'm' : ''}${
    inputs.avoidToll ? 't' : ''
  }`;
  return `${opts}|${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}`;
}

/** A computation starts: nothing already on screen is thrown away. */
export function beginGeometry(state: RouteState, key: string): RouteState {
  const sameTrip = state.key === key;
  return {
    ...state,
    geometry: 'loading',
    corridor: sameTrip ? state.corridor : 'idle',
    pendingKey: key,
    provisional: state.route != null && !sameTrip,
    geometryError: undefined,
    corridorError: sameTrip ? state.corridorError : undefined,
  };
}

/** The routing engine answered: publish the itinerary, start the corridor. */
export function commitGeometry(
  state: RouteState,
  key: string,
  route: Route,
  endpoints: RouteEndpoints,
): RouteState {
  if (state.pendingKey !== key) return state;
  const sameTrip = state.key === key;
  return {
    ...state,
    route,
    endpoints,
    // Stops belong to the geometry they were placed along; for a new trip they
    // are dropped and the list shows placeholders until the corridor answers.
    stations: sameTrip ? state.stations : [],
    geometry: 'ready',
    corridor: 'loading',
    key,
    provisional: false,
    geometryError: undefined,
    corridorError: undefined,
  };
}

/** The routing engine failed: whatever was on screen stays, flagged as stale. */
export function failGeometry(state: RouteState, key: string, message: string): RouteState {
  if (state.pendingKey !== key) return state;
  return {
    ...state,
    geometry: 'error',
    geometryError: message,
    provisional: state.route != null && state.key !== key,
  };
}

export function beginCorridor(state: RouteState, key: string): RouteState {
  if (state.key !== key) return state;
  return { ...state, corridor: 'loading', corridorError: undefined };
}

export function commitCorridor(
  state: RouteState,
  key: string,
  stations: RouteStation[],
): RouteState {
  if (state.key !== key) return state;
  return { ...state, stations, corridor: 'ready', corridorError: undefined, provisional: false };
}

/** The corridor failed: the real geometry stays, the stops stage is retryable. */
export function failCorridor(state: RouteState, key: string, message: string): RouteState {
  if (state.key !== key) return state;
  return { ...state, corridor: 'error', corridorError: message };
}

/** true while any stage of the pipeline is still running */
export function routeBusy(state: RouteState): boolean {
  return state.geometry === 'loading' || state.corridor === 'loading';
}
