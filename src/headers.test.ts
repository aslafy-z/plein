// public/_headers is the only place the deployed app (Workers static assets,
// no Worker script) can set response headers. These guards keep the baseline
// security block from being dropped or narrowed to a path by a later edit.
import { describe, expect, it } from 'vitest'
import HEADERS from '../public/_headers?raw'

/** Header name → value for the rule whose path line is exactly `path`. */
function rule(path: string): Map<string, string> {
  const lines = HEADERS.split('\n')
  const out = new Map<string, string>()
  for (let i = lines.indexOf(path) + 1; i > 0 && /^\s+\S/.test(lines[i] ?? ''); i++) {
    const [, name, value] = /^\s+([^:]+):\s*(.*)$/.exec(lines[i]) ?? []
    if (name) out.set(name.toLowerCase(), value.trim())
  }
  return out
}

describe('response headers', () => {
  const all = rule('/*')

  it('sends the baseline security headers with every response', () => {
    expect(all.get('x-content-type-options')).toBe('nosniff')
    expect(all.get('x-frame-options')).toBe('DENY')
    expect(all.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })

  it('keeps geolocation, and never switches off clipboard or Web Share', () => {
    const policy = all.get('permissions-policy') ?? ''
    expect(policy).toContain('geolocation=(self)')
    // « Share » falls back to the clipboard, and the debug snapshot copies
    // to it: both rely on the default (self) allowlist staying untouched.
    expect(policy).not.toMatch(/clipboard-write|web-share/)
  })

  it('leaves caching to the path rules', () => {
    // A Cache-Control on `/*` would be merged into every path rule's own.
    expect(all.has('cache-control')).toBe(false)
    expect(rule('/assets/*').get('cache-control')).toContain('immutable')
  })
})
