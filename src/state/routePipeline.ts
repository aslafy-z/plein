// Staged route pipeline — the state a route computation moves through, and the
// pure transitions between stages.
//
// A route is built in three stages: the geometry (distance, duration,
// polyline), the stations in its corridor, and the road matrix the fuel-stop
// plan runs on. Modelling them separately is what lets the itinerary and the
// map show up before any station is known, lets a stage fail and be retried on
// its own, and lets the previous result stay on screen while a new one
// computes instead of being blanked. The matrix stage never blocks the plan:
// while it loads or when it fails, the plan runs on geometric estimates and
// says so — its commit upgrades the legs, it does not create the answer.
//
// Every transition is guarded by the input signature it was started for, so a
// slow answer for endpoints the user has since edited can never overwrite a
// newer result. The store additionally guards on a generation counter, which
// distinguishes two runs that share the same signature (a stage retried twice).
import type { ReachInfo, Route, RouteStation } from '../data/types';
import type { GeoPoint } from '../lib/geo';

export type StageStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The matrix stage carries one status the other stages cannot: a source
 * without a matrix backend is not a failure — there is nothing to wait for
 * and nothing to retry (the demo provider is deliberately there). Collapsing
 * `unsupported` into `error` is how a real outage becomes invisible.
 */
export type MatrixStatus = StageStatus | 'unsupported';

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
  /**
   * Road legs of the fuel-stop plan — one square matrix call per candidate
   * set. Not a barrier: the plan always has an answer (geometric estimates,
   * flagged as such), this stage only decides whether the legs are routed.
   */
  matrix: MatrixStatus;
  /** Identity of the candidate set + endpoints + options `matrixCells` answer
      for — a changed key means a different matrix must be fetched */
  matrixKey: string | null;
  /** Square matrix over [origin, ...candidates, destination]; null cells are
      unroutable pairs */
  matrixCells: Array<Array<ReachInfo | null>> | null;
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
  matrix: 'idle',
  matrixKey: null,
  matrixCells: null,
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
 * « Avoid tolls » are a different result.
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
    // The matrix answers for a candidate set drawn from those stops — a new
    // trip resets it with them (the store re-keys it after the corridor lands).
    matrix: sameTrip ? state.matrix : 'idle',
    matrixKey: sameTrip ? state.matrixKey : null,
    matrixCells: sameTrip ? state.matrixCells : null,
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

// ── Matrix stage ─────────────────────────────────────────────────────────────

/**
 * Everything that identifies one matrix call — the endpoints, the routing
 * options and the exact candidate set. A changed key means the stored cells
 * answer a different question and a new call must go out; an unchanged key
 * (a corridor retry landing the same stations) reuses them.
 */
export function travelMatrixKey(
  source: string,
  from: GeoPoint,
  to: GeoPoint,
  candidateIds: readonly string[],
  options: { avoidMotorway: boolean; avoidToll: boolean; vehicle: string },
): string {
  return [
    source,
    from.lat.toFixed(4),
    from.lng.toFixed(4),
    to.lat.toFixed(4),
    to.lng.toFixed(4),
    options.avoidMotorway ? 'm1' : 'm0',
    options.avoidToll ? 't1' : 't0',
    options.vehicle,
    ...candidateIds,
  ].join('|');
}

/** A matrix call goes out for `matrixKey` — old cells answer another set. */
export function beginMatrix(state: RouteState, matrixKey: string): RouteState {
  return { ...state, matrix: 'loading', matrixKey, matrixCells: null };
}

/** The matrix answered: the plan's legs upgrade from estimated to routed. */
export function commitMatrix(
  state: RouteState,
  matrixKey: string,
  cells: Array<Array<ReachInfo | null>>,
): RouteState {
  if (state.matrixKey !== matrixKey) return state;
  return { ...state, matrix: 'ready', matrixCells: cells };
}

/** The call failed for good (retries exhausted): the plan stays on estimates. */
export function failMatrix(state: RouteState, matrixKey: string): RouteState {
  if (state.matrixKey !== matrixKey) return state;
  return { ...state, matrix: 'error', matrixCells: null };
}

/**
 * Nothing to measure: no route stands, the corridor holds no candidate
 * (`idle`), or the source has no matrix backend (`unsupported`). Identity when
 * already there, so the store's effect can dispatch it unconditionally.
 */
export function matrixBlocked(state: RouteState, status: 'idle' | 'unsupported'): RouteState {
  if (state.matrix === status && state.matrixKey === null) return state;
  return { ...state, matrix: status, matrixKey: null, matrixCells: null };
}

/** true while any blocking stage of the pipeline is still running — the
    matrix stage is deliberately absent: the plan answers without it */
export function routeBusy(state: RouteState): boolean {
  return state.geometry === 'loading' || state.corridor === 'loading';
}
