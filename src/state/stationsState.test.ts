import { describe, expect, it } from 'vitest'
import type { Station } from '../data/types'
import { nextStationsState, type StationsEvent, type StationsState } from './store'

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

  it('is pure: same input twice gives the same output and never mutates prev', () => {
    const prev = last(frames(idle, [{ kind: 'success', data: [station('a')], source: 'fr', fetchedAt: 1_000 }]))
    const snapshot = structuredClone(prev)
    const ev: StationsEvent = { kind: 'failure', source: 'fr', error: 'source' }
    expect(nextStationsState(prev, ev)).toEqual(nextStationsState(prev, ev))
    expect(prev).toEqual(snapshot)
  })
})
