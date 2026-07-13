import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execFile, execFileSync } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { cloudflare } from "@cloudflare/vite-plugin";

// ── Build version ─────────────────────────────────────────────────────────────
// Stamped into the bundle (`__APP_VERSION__`) and into `/version.json`, which the
// running app polls to notice it is outdated (see src/lib/appUpdate.ts). A dirty
// tree gets a timestamp too: two deploys from uncommitted work must not collide
// on the same commit hash, or the second one would look like no change at all.
function buildVersion(): string {
  const git = (args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    const sha = git(['rev-parse', '--short', 'HEAD'])
    return git(['status', '--porcelain']) ? `${sha}+${Date.now().toString(36)}` : sha
  } catch {
    return Date.now().toString(36)
  }
}

function versionStamp(version: string): Plugin {
  return {
    name: 'plein-version-stamp',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      })
    },
  }
}

// ── Dev/preview tile proxy ────────────────────────────────────────────────────
// Sandboxed / firewalled environments often let the dev server reach the
// internet (via HTTPS_PROXY) while the browser itself cannot. The app first
// tries the CARTO dark CDN directly; when those tiles fail it falls back to
// `/tiles/{z}/{x}/{y}.png`, which this middleware serves from OpenStreetMap.
const OSM = 'https://tile.openstreetmap.org'
const UA = 'plein-dev-tile-proxy/1 (local development)'
const CACHE_MAX = 600
const tileCache = new Map<string, Buffer>()

function fetchTile(url: string): Promise<Buffer> {
  // curl honors HTTPS_PROXY; Node fetch does not — use curl when a proxy is set
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    return new Promise((resolve, reject) => {
      execFile(
        'curl',
        ['-sS', '--fail', '--max-time', '15', '-A', UA, url],
        { encoding: 'buffer', maxBuffer: 8e6 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      )
    })
  }
  return fetch(url, { headers: { 'User-Agent': UA } }).then(async (res) => {
    if (!res.ok) throw new Error(`tile HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  })
}

function tileHandler(req: IncomingMessage, res: ServerResponse): void {
  const m = (req.url ?? '').match(/^\/(\d{1,2})\/(\d+)\/(\d+)(?:@2x)?\.png$/)
  if (!m) {
    res.statusCode = 404
    res.end()
    return
  }
  const key = `${m[1]}/${m[2]}/${m[3]}`
  const cached = tileCache.get(key)
  const send = (buf: Buffer) => {
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.end(buf)
  }
  if (cached) {
    send(cached)
    return
  }
  fetchTile(`${OSM}/${key}.png`)
    .then((buf) => {
      if (tileCache.size >= CACHE_MAX) {
        const first = tileCache.keys().next().value
        if (first) tileCache.delete(first)
      }
      tileCache.set(key, buf)
      send(buf)
    })
    .catch(() => {
      res.statusCode = 502
      res.end()
    })
}

// ── Dev/preview API proxy ─────────────────────────────────────────────────────
// Same story for the data sources: in dev the app calls /proxy/<name>/… and the
// dev server forwards to the real endpoint (through HTTPS_PROXY when set), so
// the app shows live data even when the browser has no direct internet access.
const API_UPSTREAMS: Record<string, string> = {
  gouv: 'https://data.economie.gouv.fr',
  ban: 'https://api-adresse.data.gouv.fr',
  osrm: 'https://router.project-osrm.org',
  valhalla: 'https://valhalla1.openstreetmap.de',
}

function fetchJson(url: string): Promise<{ status: number; body: string }> {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    return new Promise((resolve, reject) => {
      execFile(
        'curl',
        ['-sS', '--max-time', '25', '-A', UA, '-w', '\n__STATUS__%{http_code}', url],
        { maxBuffer: 64e6 },
        (err, stdout) => {
          if (err) return reject(err)
          const idx = stdout.lastIndexOf('\n__STATUS__')
          resolve({ status: parseInt(stdout.slice(idx + 11), 10), body: stdout.slice(0, idx) })
        },
      )
    })
  }
  return fetch(url, { headers: { 'User-Agent': UA } }).then(async (res) => ({
    status: res.status,
    body: await res.text(),
  }))
}

function apiHandler(req: IncomingMessage, res: ServerResponse): void {
  const m = (req.url ?? '').match(/^\/(gouv|ban|osrm|valhalla)(\/.*)$/)
  if (!m) {
    res.statusCode = 404
    res.end()
    return
  }
  fetchJson(`${API_UPSTREAMS[m[1]]}${m[2]}`)
    .then(({ status, body }) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(body)
    })
    .catch(() => {
      res.statusCode = 502
      res.end()
    })
}

function devProxies(): Plugin {
  const mount = (middlewares: { use(path: string, fn: typeof tileHandler): void }) => {
    middlewares.use('/tiles', tileHandler)
    middlewares.use('/proxy', apiHandler)
  }
  return {
    name: 'plein-dev-proxies',
    configureServer(server) {
      mount(server.middlewares)
    },
    configurePreviewServer(server) {
      mount(server.middlewares)
    },
  }
}

// https://vite.dev/config/
const APP_VERSION = buildVersion()

export default defineConfig({
  plugins: [react(), devProxies(), versionStamp(APP_VERSION), cloudflare()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    host: true,
    port: 5173,
  },
})