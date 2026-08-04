import { describe, expect, it } from 'vitest'
import type { Route, RouteStation } from '../data/types'
import {
  beginCorridor,
  beginGeometry,
  beginMatrix,
  commitCorridor,
  commitGeometry,
  commitMatrix,
  failCorridor,
  failGeometry,
  failMatrix,
  initialRouteState,
  matrixBlocked,
  routeBusy,
  routeKey,
  travelMatrixKey,
  type RouteInputs,
  type RouteState,
} from './routePipeline'

const LYON = { lat: 45.7406, lng: 4.8156 }
const BORDEAUX = { lat: 44.8378, lng: -0.5792 }
const PARIS = { lat: 48.8412, lng: 2.3003 }

const INPUTS: RouteInputs = {
  source: 'auto',
  avoidMotorway: false,
  avoidToll: false,
  vehicle: 'car',
}

const KEY_A = routeKey(LYON, BORDEAUX, INPUTS)
const KEY_B = routeKey(LYON, PARIS, INPUTS)

const ENDS_A = { from: 'Lyon Confluence', to: 'Bordeaux centre' }
const ENDS_B = { from: 'Lyon Confluence', to: 'Paris 15e' }

const route = (distanceKm: number): Route => ({
  distanceKm,
  durationMin: distanceKm / 1.5,
  polyline: [LYON, BORDEAUX],
})

const station = (id: string, kmAlong: number): RouteStation => ({
  id,
  name: `Station ${id}`,
  init: 'ST',
  lat: 45,
  lng: 3,
  address: '',
  city: '',
  prices: { diesel: { value: 1.7 } },
  tags: [],
  services: [],
  highway: false,
  kmAlong,
  detourMin: 0,
  offRouteKm: 0,
})

/** A finished computation for KEY_A: geometry and stations both committed. */
function ready(): RouteState {
  let s = beginGeometry(initialRouteState, KEY_A)
  s = commitGeometry(s, KEY_A, route(543), ENDS_A)
  return commitCorridor(s, KEY_A, [station('a', 120), station('b', 300)])
}

describe('routeKey', () => {
  it('is stable for the same endpoints and options', () => {
    expect(routeKey(LYON, BORDEAUX, INPUTS)).toBe(routeKey(LYON, BORDEAUX, INPUTS))
  })

  it('ignores differences below ~11 m', () => {
    expect(routeKey({ lat: LYON.lat + 0.00001, lng: LYON.lng }, BORDEAUX, INPUTS)).toBe(KEY_A)
  })

  it('separates destinations, sources and routing options', () => {
    expect(KEY_B).not.toBe(KEY_A)
    expect(routeKey(LYON, BORDEAUX, { ...INPUTS, source: 'demo' })).not.toBe(KEY_A)
    expect(routeKey(LYON, BORDEAUX, { ...INPUTS, avoidToll: true })).not.toBe(KEY_A)
    expect(routeKey(LYON, BORDEAUX, { ...INPUTS, avoidMotorway: true })).not.toBe(KEY_A)
    expect(routeKey(LYON, BORDEAUX, { ...INPUTS, vehicle: 'truck' })).not.toBe(KEY_A)
  })
})

describe('geometry stage', () => {
  it('publishes the itinerary before any station is known', () => {
    const s = commitGeometry(beginGeometry(initialRouteState, KEY_A), KEY_A, route(543), ENDS_A)
    expect(s.geometry).toBe('ready')
    expect(s.corridor).toBe('loading')
    expect(s.route?.distanceKm).toBe(543)
    expect(s.stations).toEqual([])
    expect(s.provisional).toBe(false)
  })

  it('keeps the previous result on screen while a new trip computes', () => {
    const s = beginGeometry(ready(), KEY_B)
    expect(s.geometry).toBe('loading')
    expect(s.route?.distanceKm).toBe(543)
    expect(s.stations).toHaveLength(2)
    expect(s.provisional).toBe(true)
  })

  it('never relabels a stale result with the endpoints being computed', () => {
    const pending = beginGeometry(ready(), KEY_B)
    expect(pending.endpoints).toEqual(ENDS_A)
    expect(commitGeometry(pending, KEY_B, route(465), ENDS_B).endpoints).toEqual(ENDS_B)
  })

  it('does not flag a recompute of the same trip as provisional', () => {
    const s = beginGeometry(ready(), KEY_A)
    expect(s.provisional).toBe(false)
    expect(s.stations).toHaveLength(2)
  })

  it('keeps the stops when the same trip is recomputed', () => {
    const s = commitGeometry(beginGeometry(ready(), KEY_A), KEY_A, route(544), ENDS_A)
    expect(s.route?.distanceKm).toBe(544)
    expect(s.stations).toHaveLength(2)
  })

  it('keeps the last good route when a new computation fails', () => {
    const s = failGeometry(beginGeometry(ready(), KEY_B), KEY_B, 'boom')
    expect(s.geometry).toBe('error')
    expect(s.geometryError).toBe('boom')
    expect(s.route?.distanceKm).toBe(543)
    expect(s.stations).toHaveLength(2)
    expect(s.provisional).toBe(true)
  })

  it('reports a cold failure with nothing to fall back on', () => {
    const s = failGeometry(beginGeometry(initialRouteState, KEY_A), KEY_A, 'boom')
    expect(s.geometry).toBe('error')
    expect(s.route).toBeNull()
    expect(s.provisional).toBe(false)
  })

  it('recovers from a failed geometry when retried', () => {
    const failed = failGeometry(beginGeometry(initialRouteState, KEY_A), KEY_A, 'boom')
    const s = commitGeometry(beginGeometry(failed, KEY_A), KEY_A, route(543), ENDS_A)
    expect(s.geometry).toBe('ready')
    expect(s.geometryError).toBeUndefined()
  })

  it('refuses a commit for endpoints the user has already edited away', () => {
    const pending = beginGeometry(ready(), KEY_B)
    expect(commitGeometry(pending, KEY_A, route(999), ENDS_A)).toEqual(pending)
  })

  it('refuses a failure for endpoints the user has already edited away', () => {
    const pending = beginGeometry(ready(), KEY_B)
    expect(failGeometry(pending, KEY_A, 'boom')).toEqual(pending)
  })
})

describe('corridor stage', () => {
  it('publishes the stops and clears the provisional flag', () => {
    const s = commitCorridor(
      commitGeometry(beginGeometry(ready(), KEY_B), KEY_B, route(465), ENDS_B),
      KEY_B,
      [station('c', 90)],
    )
    expect(s.corridor).toBe('ready')
    expect(s.stations).toHaveLength(1)
    expect(s.provisional).toBe(false)
  })

  it('keeps the real geometry when the stops cannot be fetched', () => {
    const s = failCorridor(ready(), KEY_A, 'stations down')
    expect(s.geometry).toBe('ready')
    expect(s.route?.distanceKm).toBe(543)
    expect(s.corridor).toBe('error')
    expect(s.corridorError).toBe('stations down')
  })

  it('retries on its own without touching the geometry', () => {
    const s = beginCorridor(failCorridor(ready(), KEY_A, 'stations down'), KEY_A)
    expect(s.corridor).toBe('loading')
    expect(s.corridorError).toBeUndefined()
    expect(s.geometry).toBe('ready')
    expect(s.route?.distanceKm).toBe(543)
  })

  it('refuses commits and failures belonging to another trip', () => {
    const s = ready()
    expect(commitCorridor(s, KEY_B, [station('z', 10)])).toEqual(s)
    expect(failCorridor(s, KEY_B, 'boom')).toEqual(s)
    expect(beginCorridor(s, KEY_B)).toEqual(s)
  })
})

describe('a full recompute', () => {
  it('never blanks the itinerary between the two trips', () => {
    const seen: (Route | null)[] = []
    let s = ready()
    seen.push(s.route)
    s = beginGeometry(s, KEY_B)
    seen.push(s.route)
    s = commitGeometry(s, KEY_B, route(465), ENDS_B)
    seen.push(s.route)
    s = commitCorridor(s, KEY_B, [station('c', 90)])
    seen.push(s.route)
    expect(seen.every((r) => r != null)).toBe(true)
    expect(s.route?.distanceKm).toBe(465)
  })
})

describe('routeBusy', () => {
  it('is true while either stage runs and false once both have settled', () => {
    expect(routeBusy(initialRouteState)).toBe(false)
    expect(routeBusy(beginGeometry(initialRouteState, KEY_A))).toBe(true)
    expect(
      routeBusy(commitGeometry(beginGeometry(initialRouteState, KEY_A), KEY_A, route(1), ENDS_A)),
    ).toBe(true)
    expect(routeBusy(ready())).toBe(false)
    expect(routeBusy(failCorridor(ready(), KEY_A, 'boom'))).toBe(false)
  })

  it('never counts the matrix stage — the plan answers without it', () => {
    expect(routeBusy(beginMatrix(ready(), 'mk'))).toBe(false)
  })
})

// ── Matrix stage ─────────────────────────────────────────────────────────────
describe('matrix stage', () => {
  const MK = travelMatrixKey('fr', LYON, BORDEAUX, ['a', 'b'], {
    avoidMotorway: false,
    avoidToll: false,
    vehicle: 'car',
  })
  const cells = [[null]]

  it('keys on the candidate set and the routing options', () => {
    const opts = { avoidMotorway: false, avoidToll: false, vehicle: 'car' }
    expect(travelMatrixKey('fr', LYON, BORDEAUX, ['a', 'b'], opts)).toBe(MK)
    expect(travelMatrixKey('fr', LYON, BORDEAUX, ['a', 'c'], opts)).not.toBe(MK)
    expect(
      travelMatrixKey('fr', LYON, BORDEAUX, ['a', 'b'], { ...opts, avoidToll: true }),
    ).not.toBe(MK)
  })

  it('commits only for the key it was begun with', () => {
    let s = beginMatrix(ready(), MK)
    expect(s.matrix).toBe('loading')
    // A stale answer for another candidate set changes nothing
    expect(commitMatrix(s, 'old-key', cells)).toBe(s)
    s = commitMatrix(s, MK, cells)
    expect(s.matrix).toBe('ready')
    expect(s.matrixCells).toBe(cells)
  })

  it('fails only for the key in flight, and keeps the route standing', () => {
    const s = beginMatrix(ready(), MK)
    expect(failMatrix(s, 'old-key')).toBe(s)
    const failed = failMatrix(s, MK)
    expect(failed.matrix).toBe('error')
    expect(failed.matrixCells).toBeNull()
    expect(failed.route).not.toBeNull()
    expect(failed.stations.length).toBe(2)
  })

  it('re-keying clears the previous cells — they answer another set', () => {
    const first = commitMatrix(beginMatrix(ready(), MK), MK, cells)
    const rekeyed = beginMatrix(first, 'other')
    expect(rekeyed.matrixCells).toBeNull()
    expect(rekeyed.matrixKey).toBe('other')
  })

  it('matrixBlocked is an identity when already blocked the same way', () => {
    const idle = matrixBlocked(ready(), 'idle')
    expect(matrixBlocked(idle, 'idle')).toBe(idle)
    const unsupported = matrixBlocked(idle, 'unsupported')
    expect(unsupported.matrix).toBe('unsupported')
    expect(matrixBlocked(unsupported, 'unsupported')).toBe(unsupported)
  })

  it('a NEW trip resets the matrix; the same trip keeps it', () => {
    const withMatrix = commitMatrix(beginMatrix(ready(), MK), MK, cells)
    // Same trip recomputed (a retry): the cells still answer the same set
    let same = beginGeometry(withMatrix, KEY_A)
    same = commitGeometry(same, KEY_A, route(543), ENDS_A)
    expect(same.matrix).toBe('ready')
    expect(same.matrixCells).toBe(cells)
    // Different trip: stations drop, and the matrix with them
    let other = beginGeometry(withMatrix, KEY_B)
    other = commitGeometry(other, KEY_B, route(465), ENDS_B)
    expect(other.matrix).toBe('idle')
    expect(other.matrixKey).toBeNull()
    expect(other.matrixCells).toBeNull()
  })
})
