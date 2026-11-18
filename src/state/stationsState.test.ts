import { describe, expect, it } from 'vitest'
import type { Station } from '../data/types'
import {
  MAX_RETAINED_AREAS,
  nextStationsState,
  retainedStations,
  type StationsArea,
  type StationsEvent,
  type StationsState,
} from './store'

// The invariant under test: real data on screen stays on screen. Failures
// flag the state instead of substituting anything, and `loading` is reserved
// for "nothing worth painting yet".

const station = (id: string): Station => ({
  id,
  name: `Station ${id}`,
  init: 'ST',
  lat: 43.6,
  lng: 1.44,
  address: '1 rue du Test',
  city: 'Toulouse',
  prices: { diesel: { value: 1.75 } },
  tags: [],
  services: [],
  highway: false,
})

const idle: StationsState = { status: 'idle', data: [], activeSource: 'fr', refreshing: false }

/** Every intermediate frame of an event chain, initial state included */
function frames(from: StationsState, events: StationsEvent[]): StationsState[] {
  const out = [from]
  for (const ev of events) out.push(nextStationsState(out[out.length - 1], ev))
  return out
}

const last = (list: StationsState[]) => list[list.length - 1]

describe('nextStationsState', () => {
  it('cold load: request paints loading, success lands clean', () => {
    const chain = frames(idle, [
      { kind: 'request', offlineHint: false },
      { kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 5_000 },
    ])
    expect(chain[1]).toMatchObject({ status: 'loading', refreshing: false })
    expect(last(chain)).toEqual({
      status: 'ready',
      data: [station('a')],
      activeSource: 'fr',
      fetchedAt: 5_000,
      refreshing: false,
      retained: [],
      others: [],
    })
    expect(last(chain).lastError).toBeUndefined()
  })

  it('cold failure with nothing to keep is an explicit error, never a substitute', () => {
    const end = last(
      frames(idle, [
        { kind: 'request', offlineHint: true },
        { kind: 'failure', source: 'fr', error: 'offline' },
      ]),
    )
    expect(end).toMatchObject({ status: 'error', data: [], lastError: 'offline' })
  })

  it('a failing revalidation keeps the painted cache and never passes through loading', () => {
    const chain = frames(idle, [
      { kind: 'cache', data: [station('a')], source: 'fr', fetchedAt: 1_000, revalidating: true },
      { kind: 'failure', source: 'fr', error: 'source' },
    ])
    expect(chain.some((s) => s.status === 'loading')).toBe(false)
    expect(last(chain)).toMatchObject({
      status: 'ready',
      data: [station('a')],
      refreshing: false,
      lastError: 'source',
      fetchedAt: 1_000,
    })
  })

  it('a transient failure after a success keeps the loaded stations on screen', () => {
    const end = last(
      frames(idle, [
        { kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 },
        { kind: 'request', offlineHint: false },
        { kind: 'failure', source: 'fr', error: 'source' },
      ]),
    )
    expect(end).toMatchObject({ status: 'ready', lastError: 'source' })
    expect(end.data.map((s) => s.id)).toEqual(['a'])
  })

  it('with the browser positive about being offline, the attempt runs behind the data', () => {
    const chain = frames(idle, [
      { kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 },
      { kind: 'request', offlineHint: true },
      { kind: 'failure', source: 'fr', error: 'offline' },
    ])
    // No loading frame: the card must not reset while panning offline
    expect(chain[2]).toMatchObject({ status: 'ready', refreshing: true })
    expect(last(chain)).toMatchObject({ status: 'ready', refreshing: false, lastError: 'offline' })
  })

  it('painting from cache preserves a standing failure, success clears it', () => {
    const failed = last(
      frames(idle, [
        { kind: 'request', offlineHint: false },
        { kind: 'failure', source: 'fr', error: 'offline' },
      ]),
    )
    const cached = nextStationsState(failed, {
      kind: 'cache',
      data: [station('b')],
      source: 'fr',
      fetchedAt: 2_000,
      revalidating: false,
    })
    expect(cached).toMatchObject({ status: 'ready', lastError: 'offline', refreshing: false })

    const recovered = nextStationsState(cached, {
      kind: 'success',
      data: [station('c')],
      source: 'fr',
      fetchedAt: 3_000,
    })
    expect(recovered.lastError).toBeUndefined()
    expect(recovered.data.map((s) => s.id)).toEqual(['c'])
  })

  it('a failure on another source drops the previous source data instead of relabelling it', () => {
    const end = last(
      frames(idle, [
        { kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 },
        { kind: 'request', offlineHint: false },
        { kind: 'failure', source: 'es', error: 'offline' },
      ]),
    )
    expect(end).toMatchObject({ status: 'error', data: [], activeSource: 'es' })
  })

  it('a superseded cold request settles back on the loaded area instead of sticking on loading', () => {
    const chain = frames(idle, [
      { kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 },
      { kind: 'request', offlineHint: false },
      { kind: 'superseded', standing: 'loaded', source: 'fr' },
    ])
    expect(chain[2].status).toBe('loading')
    expect(last(chain)).toEqual(chain[1])
  })

  it('a superseded request over a loaded area with no station is ready, not an error', () => {
    const end = last(
      frames(idle, [
        { kind: 'success', data: [], source: 'fr', fetchedAt: 1_000 },
        { kind: 'request', offlineHint: false },
        { kind: 'superseded', standing: 'loaded', source: 'fr' },
      ]),
    )
    expect(end).toMatchObject({ status: 'ready', data: [], refreshing: false })
    expect(end.lastError).toBeUndefined()
  })

  it('a superseded background attempt stops refreshing', () => {
    const end = last(
      frames(idle, [
        { kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 },
        { kind: 'request', offlineHint: true },
        { kind: 'superseded', standing: 'loaded', source: 'fr' },
      ]),
    )
    expect(end).toMatchObject({ status: 'ready', refreshing: false })
    expect(end.data.map((s) => s.id)).toEqual(['a'])
  })

  it('back inside a failed area with nothing cached, a superseded request returns to the error', () => {
    const chain = frames(idle, [
      { kind: 'request', offlineHint: false },
      { kind: 'failure', source: 'fr', error: 'offline' },
      // Pan out: a new request starts and hangs
      { kind: 'request', offlineHint: false },
      // Pan back in before it settles
      { kind: 'superseded', standing: 'failed', source: 'fr' },
    ])
    expect(chain[3].status).toBe('loading')
    expect(last(chain)).toEqual(chain[2])
  })

  it('back inside a failed area, a superseded request keeps the data the failure kept', () => {
    const end = last(
      frames(idle, [
        { kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 },
        { kind: 'request', offlineHint: false },
        { kind: 'failure', source: 'fr', error: 'source' },
        { kind: 'request', offlineHint: false },
        { kind: 'superseded', standing: 'failed', source: 'fr' },
      ]),
    )
    expect(end).toMatchObject({ status: 'ready', refreshing: false, lastError: 'source' })
    expect(end.data.map((s) => s.id)).toEqual(['a'])
  })

  it('a failed area never settles on another source data', () => {
    const end = last(
      frames(idle, [
        { kind: 'cache', data: [station('a')], source: 'es', fetchedAt: 1_000, revalidating: true },
        { kind: 'superseded', standing: 'failed', source: 'fr' },
      ]),
    )
    expect(end).toMatchObject({ status: 'error', data: [], activeSource: 'fr', refreshing: false })
  })

  it('superseding with nothing pending is the identity, so a pan re-renders nothing', () => {
    const ready = last(
      frames(idle, [{ kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 }]),
    )
    expect(nextStationsState(ready, { kind: 'superseded', standing: 'loaded', source: 'fr' })).toBe(
      ready,
    )
    const failed = last(
      frames(idle, [
        { kind: 'request', offlineHint: false },
        { kind: 'failure', source: 'fr', error: 'offline' },
      ]),
    )
    expect(
      nextStationsState(failed, { kind: 'superseded', standing: 'failed', source: 'fr' }),
    ).toBe(failed)
  })

  it('is pure: same input twice gives the same output and never mutates prev', () => {
    const prev = last(
      frames(idle, [{ kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 }]),
    )
    const snapshot = structuredClone(prev)
    const ev: StationsEvent = { kind: 'failure', source: 'fr', error: 'source' }
    expect(nextStationsState(prev, ev)).toEqual(nextStationsState(prev, ev))
    expect(prev).toEqual(snapshot)
  })
})

// #144: panning from one fetched area into the next used to wipe the first
// one's pins the moment the second landed, data still in memory. Earlier
// areas of the same source are now retained, and what they add beyond the
// painted area is `others`, which the map (and only the map) draws.
describe('nextStationsState: earlier areas stay on the map', () => {
  const TOULOUSE = { lat: 43.6047, lng: 1.4442 }
  const MONTAUBAN = { lat: 44.0176, lng: 1.355 }
  const at = (id: string, p: { lat: number; lng: number }, diesel = 1.75): Station => ({
    ...station(id),
    lat: p.lat,
    lng: p.lng,
    prices: { diesel: { value: diesel } },
  })
  const disc = (center: { lat: number; lng: number }, radiusKm = 25): StationsArea => ({
    center,
    radiusKm,
  })
  const success = (
    data: Station[],
    area: StationsArea,
    fetchedAt: number,
    source: 'fr' | 'es' = 'fr',
  ): StationsEvent => ({ kind: 'success', data, source, fetchedAt, area })

  it('keeps the first area pins when the second lands', () => {
    const end = last(
      frames(idle, [
        success([at('tls', TOULOUSE)], disc(TOULOUSE), 1_000),
        success([at('mtb', MONTAUBAN)], disc(MONTAUBAN), 2_000),
      ]),
    )
    expect(end.data.map((s) => s.id)).toEqual(['mtb'])
    expect(end.others?.map((s) => s.id)).toEqual(['tls'])
    // The zone keeps describing the area it was fetched with
    expect(end.fetchedAt).toBe(2_000)
    expect(end.area).toEqual(disc(MONTAUBAN))
  })

  it('lets the painted area win a station both list, at its newer price', () => {
    const shared = { lat: 43.8, lng: 1.4 }
    const end = last(
      frames(idle, [
        success([at('tls', TOULOUSE), at('mid', shared, 1.7)], disc(TOULOUSE), 1_000),
        success([at('mtb', MONTAUBAN), at('mid', shared, 1.8)], disc(MONTAUBAN), 2_000),
      ]),
    )
    expect(end.others?.map((s) => s.id)).toEqual(['tls'])
    expect(end.data.find((s) => s.id === 'mid')?.prices.diesel?.value).toBe(1.8)
  })

  it('never brings back a station a newer area no longer lists inside its disc', () => {
    // Closed since: the Montauban fetch covers it and does not list it
    const closed = at('closed', { lat: 43.95, lng: 1.36 })
    const end = last(
      frames(idle, [
        success([at('tls', TOULOUSE), closed], disc(TOULOUSE, 50), 1_000),
        success([at('mtb', MONTAUBAN)], disc(MONTAUBAN), 2_000),
      ]),
    )
    expect(end.others?.map((s) => s.id)).toEqual(['tls'])
  })

  it('replaces, rather than retains, a repaint of the same area', () => {
    const end = last(
      frames(idle, [
        {
          kind: 'cache',
          data: [at('tls', TOULOUSE, 1.7)],
          source: 'fr',
          fetchedAt: 1_000,
          revalidating: true,
          area: disc(TOULOUSE),
        },
        success([at('tls', TOULOUSE, 1.8)], disc({ lat: 43.61, lng: 1.45 }), 2_000),
      ]),
    )
    expect(end.retained).toEqual([])
    expect(end.others).toEqual([])
  })

  it('keeps the union through a failed refresh', () => {
    const end = last(
      frames(idle, [
        success([at('tls', TOULOUSE)], disc(TOULOUSE), 1_000),
        success([at('mtb', MONTAUBAN)], disc(MONTAUBAN), 2_000),
        { kind: 'request', offlineHint: true },
        { kind: 'failure', source: 'fr', error: 'offline' },
      ]),
    )
    expect(end.data.map((s) => s.id)).toEqual(['mtb'])
    expect(end.others?.map((s) => s.id)).toEqual(['tls'])
  })

  it('drops every earlier area on a source switch', () => {
    const MADRID = { lat: 40.4168, lng: -3.7038 }
    const end = last(
      frames(idle, [
        success([at('tls', TOULOUSE)], disc(TOULOUSE), 1_000),
        success([at('mad', MADRID)], disc(MADRID), 2_000, 'es'),
      ]),
    )
    expect(end.retained).toEqual([])
    expect(end.others).toEqual([])
  })

  it('keeps as many areas as the durable cache, newest first', () => {
    const areas = Array.from({ length: MAX_RETAINED_AREAS + 3 }, (_, i) => ({
      lat: 43 + i * 0.5,
      lng: 1.44,
    }))
    const end = last(
      frames(
        idle,
        areas.map((c, i) => success([at(`s${i}`, c)], disc(c), 1_000 * (i + 1))),
      ),
    )
    expect(end.retained).toHaveLength(MAX_RETAINED_AREAS)
    expect(end.retained?.[0].fetchedAt).toBe(1_000 * (areas.length - 1))
  })

  it('lets an area past the cache age go', () => {
    const WEEK = 7 * 24 * 3_600_000
    const end = last(
      frames(idle, [
        success([at('tls', TOULOUSE)], disc(TOULOUSE), 1_000),
        success([at('mtb', MONTAUBAN)], disc(MONTAUBAN), 1_000 + WEEK + 1),
      ]),
    )
    expect(end.others).toEqual([])
  })
})

describe('retainedStations', () => {
  const p = (id: string, lat: number): Station => ({ ...station(id), lat, lng: 1.44 })

  it('falls back on ids alone when the painted area has no geometry', () => {
    const out = retainedStations([p('a', 43.6)], undefined, [
      {
        center: { lat: 43.6, lng: 1.44 },
        radiusKm: 25,
        fetchedAt: 1,
        stations: [p('a', 43.6), p('b', 43.61)],
      },
    ])
    expect(out.map((s) => s.id)).toEqual(['b'])
  })

  it('lets a newer retained area answer for its own disc over an older one', () => {
    const newer = {
      center: { lat: 44, lng: 1.44 },
      radiusKm: 10,
      fetchedAt: 2,
      stations: [p('n', 44)],
    }
    const older = {
      center: { lat: 43.6, lng: 1.44 },
      radiusKm: 60,
      fetchedAt: 1,
      // `inside` sits in the newer disc, which does not list it
      stations: [p('o', 43.6), p('inside', 44.02)],
    }
    expect(retainedStations([], undefined, [newer, older]).map((s) => s.id)).toEqual(['n', 'o'])
  })
})
