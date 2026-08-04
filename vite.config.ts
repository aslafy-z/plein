import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from '@inlang/paraglide-js'

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

// Repository home, stamped into the bundle (`__REPO_URL__`) for the Settings
// contact links. package.json's `repository` is the single source of truth —
// the npm form (`git+…/plein.git`) is normalized to a browsable URL here.
function repoUrl(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    repository?: { url?: string }
  }
  return (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
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
// `/tiles/{z}/{x}/{y}.png`, which this middleware serves from CARTO too (same
// minimalist style as the design), with OSM as a last resort.
const CARTO = 'https://a.basemaps.cartocdn.com/dark_all'
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
  fetchTile(`${CARTO}/${key}.png`)
    .catch(() => fetchTile(`${OSM}/${key}.png`))
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
  fr: 'https://data.economie.gouv.fr',
  ban: 'https://api-adresse.data.gouv.fr',
  osrm: 'https://router.project-osrm.org',
  valhalla: 'https://valhalla1.openstreetmap.de',
  es: 'https://sedeaplicaciones.minetur.gob.es',
  cartociudad: 'https://www.cartociudad.es',
  ad: 'https://sig.govern.ad',
  pt: 'https://precoscombustiveis.dgeg.gov.pt',
  de: 'https://creativecommons.tankerkoenig.de',
  photon: 'https://photon.komoot.io',
}

/** What the app itself calls, on its own origin — no upstream file extension */
const DE_STATIONS_PATH = '/stations'
/** …and what Tankerkönig actually serves it from, never seen by the browser */
const DE_UPSTREAM_PATH = '/json/list.php'

// ── German source availability ────────────────────────────────────────────────
// The German prices need a key-holding proxy (above in dev, worker/index.ts in
// production), which not every deployment runs. This resolves ITS base path —
// stamped into the bundle as `__DE_PROXY__` — so an unconfigured build greys
// the source out instead of firing requests that can only 503:
//   • PLEIN_DE_PROXY names it explicitly (the Worker serves `/api/de`);
//   • otherwise `npm run dev` derives it from the key the middleware needs;
//   • otherwise there is none.
function deProxyBase(dev: boolean): string | null {
  if (process.env.PLEIN_DE_PROXY) return process.env.PLEIN_DE_PROXY
  if (dev && process.env.TANKERKOENIG_API_KEY) return '/proxy/de'
  return null
}

function fetchJson(url: string): Promise<{ status: number; body: string }> {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    return new Promise((resolve, reject) => {
      execFile(
        'curl',
        // --compressed: some egress proxies gzip the response even without
        // Accept-Encoding — let curl negotiate and decode it
        ['-sS', '--compressed', '--max-time', '25', '-A', UA, '-w', '\n__STATUS__%{http_code}', url],
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
  const m = (req.url ?? '').match(/^\/(fr|ban|osrm|valhalla|es|cartociudad|ad|pt|de|photon)(\/.*)$/)
  if (!m) {
    res.statusCode = 404
    res.end()
    return
  }
  let path = m[2]
  if (m[1] === 'de') {
    // The app's own route is `/proxy/de/stations`; that upstream serves it
    // from a PHP endpoint is upstream's business and stays behind the proxy.
    // Checked before the key, so an unknown path is a 404 either way.
    const q = path.indexOf('?')
    if ((q === -1 ? path : path.slice(0, q)) !== DE_STATIONS_PATH) {
      res.statusCode = 404
      res.end()
      return
    }
    // Tankerkönig needs a PERSONAL API key (free, tankerkoenig.de) that must
    // never be committed nor bundled: the dev server injects it from the
    // environment, mirroring the production Worker (worker/index.ts).
    const key = process.env.TANKERKOENIG_API_KEY
    if (!key) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end('{"ok":false,"message":"TANKERKOENIG_API_KEY not set in the dev environment"}')
      return
    }
    const params = new URLSearchParams(q === -1 ? '' : path.slice(q + 1))
    params.set('apikey', key)
    path = `${DE_UPSTREAM_PATH}?${params.toString()}`
  }
  fetchJson(`${API_UPSTREAMS[m[1]]}${path}`)
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

// ── i18n ──────────────────────────────────────────────────────────────────────
// Paraglide is a devDependency: it compiles messages/{locale}.json into plain
// tree-shakable functions under src/paraglide (gitignored, regenerated here on
// dev and build). `npm run typecheck` and `npm test` don't go through this
// config, so they run the same compile from their `pre*` scripts.
//
// The strategy list is evaluated in order: an explicit choice in Réglages
// wins, then the browser's language, then French. `url` is deliberately absent
// — screens are store state here, not routes, so there is nothing in the URL
// to carry a locale.
const paraglide = () =>
  paraglideVitePlugin({
    project: './project.inlang',
    outdir: './src/paraglide',
    emitTsDeclarations: true,
    strategy: ['custom-appSettings', 'preferredLanguage', 'baseLocale'],
  })

export default defineConfig(({ command }) => ({
  plugins: [paraglide(), react(), devProxies(), versionStamp(APP_VERSION), cloudflare()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __REPO_URL__: JSON.stringify(repoUrl()),
    __DE_PROXY__: JSON.stringify(deProxyBase(command === 'serve')),
  },
  server: {
    host: true,
    port: 5173,
  },
}))