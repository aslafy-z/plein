// Cloudflare Worker — serves the built app (ASSETS) and proxies the German
// fuel-price API (Tankerkönig, official MTS-K relay) under /api/deu/*.
//
// A PERSONAL API key is required (free registration on tankerkoenig.de). It
// lives here as a Wrangler secret — `wrangler secret put TANKERKOENIG_API_KEY`
// — and must never appear in this repository nor in the client bundle:
// Tankerkönig blocks keys that get published. Without the secret the endpoint
// answers 503 and the app treats the German source as unavailable.
//
// Responses are cached ~5 min at the edge: MTS-K refreshes every 4-5 min and
// the API allows roughly one request per minute per key, so the cache both
// speeds up repeat views and keeps the shared key under the limit.
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TANKERKOENIG_API_KEY?: string;
}

const UPSTREAM = 'https://creativecommons.tankerkoenig.de';
const ALLOWED_PATHS = new Set(['/json/list.php']);
const ALLOWED_PARAMS = ['lat', 'lng', 'rad', 'sort', 'type'];
const CACHE_TTL_S = 300;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/deu/')) return env.ASSETS.fetch(request);

    const upstreamPath = url.pathname.slice('/api/deu'.length);
    if (request.method !== 'GET' || !ALLOWED_PATHS.has(upstreamPath)) {
      return Response.json({ ok: false, message: 'not found' }, { status: 404 });
    }
    if (!env.TANKERKOENIG_API_KEY) {
      return Response.json(
        { ok: false, message: 'TANKERKOENIG_API_KEY secret not configured' },
        { status: 503 },
      );
    }

    // Canonical key-free cache key: whitelisted params only, fixed order
    const params = new URLSearchParams();
    for (const name of ALLOWED_PARAMS) {
      const v = url.searchParams.get(name);
      if (v != null) params.set(name, v);
    }
    const cacheKey = new Request(`${url.origin}/api/deu${upstreamPath}?${params.toString()}`);
    const cache = (caches as unknown as { default: Cache }).default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    params.set('apikey', env.TANKERKOENIG_API_KEY);
    const upstream = await fetch(`${UPSTREAM}${upstreamPath}?${params.toString()}`);
    const body = await upstream.text();
    const res = new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_S}`,
      },
    });
    if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};
