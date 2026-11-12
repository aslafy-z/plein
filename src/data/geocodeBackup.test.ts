import { describe, expect, it, vi } from 'vitest'
import { BackedUpGeocodeProvider } from './geocodeBackup'
import type { GeocodeProvider, GeocodeResult } from './types'

const place = (label: string): GeocodeResult => ({
  label,
  sublabel: '',
  point: { lat: 41.38, lng: 2.17 },
  kind: 'locality',
})
const answering = (label: string) => ({ search: vi.fn(async () => [place(label)]) })
const down = { search: vi.fn(async (): Promise<GeocodeResult[]> => Promise.reject(new Error('504'))) }

describe('BackedUpGeocodeProvider', () => {
  it('does not ask the backup while the primary answers', async () => {
    const backup = answering('Barcelona (backup)')
    const res = await new BackedUpGeocodeProvider(answering('Barcelona'), backup).search('barcelona')
    expect(res.map((r) => r.label)).toEqual(['Barcelona'])
    expect(backup.search).not.toHaveBeenCalled()
  })

  it('answers from the backup when the primary fails, as a complete answer', async () => {
    const onIncomplete = vi.fn()
    const res = await new BackedUpGeocodeProvider(down, answering('Barcelona')).search('barcelona', {
      onIncomplete,
    })
    expect(res.map((r) => r.label)).toEqual(['Barcelona'])
    expect(onIncomplete).not.toHaveBeenCalled()
  })

  it('keeps what the primary says about its own partial list', async () => {
    const partial: GeocodeProvider = {
      search: async (_q, opts) => {
        opts?.onIncomplete?.()
        return [place('Girona')]
      },
    }
    const onIncomplete = vi.fn()
    await new BackedUpGeocodeProvider(partial, answering('unused')).search('giron', { onIncomplete })
    expect(onIncomplete).toHaveBeenCalledTimes(1)
  })

  it('fails when the backup is down too', async () => {
    await expect(new BackedUpGeocodeProvider(down, down).search('barcelona')).rejects.toThrow('504')
  })
})
