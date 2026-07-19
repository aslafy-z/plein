// €/kWh price resolution for IRVE charge stations. No open consolidated price
// source exists in France yet (AFIR tariff feeds are mandated but not on the
// national access point as of mid-2026), so the price cascades through:
//   1. `gratuit` flag           → 0 € (authoritative schema boolean)
//   2. declared `tarification`  → parsed when it matches a €/kWh pattern
//                                 (~24 % of charge points, mostly local networks)
//   3. static per-network grid  → public/ev-prices-fr.json, hand-surveyed
//                                 ad-hoc prices of the major networks (which
//                                 rarely fill `tarification`)
// Every resolved price carries its provenance + date so the UI can qualify it.
// When AFIR feeds land, they plug in here without touching anything else.
import type { KwhPrice } from '../types';

const MIN_KWH = 0.05;
const MAX_KWH = 2;

// ── Declared tarification text ───────────────────────────────────────────────
/** "0,54 € TTC / kWh" / "0.35€/kWh" / "kWh : 0,44 €" → €/kWh, else undefined */
export function parseTarification(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase().replace(/,/g, '.');
  // Number right before a kWh unit (optional €/TTC in between)
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:€|euros?)?\s*(?:ttc)?\s*(?:\/|par\s+|le\s+)\s*kwh/);
  // "kwh : 0.44 €" — unit first
  m = m ?? t.match(/kwh\s*:?\s*(\d+(?:\.\d+)?)\s*(?:€|euros?)/);
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  return v >= MIN_KWH && v <= MAX_KWH ? v : undefined;
}

// ── Static network grid ──────────────────────────────────────────────────────
interface GridNetwork {
  name: string;
  prefixes: string[];
  operators: string[];
  acKwh: number | null;
  dcKwh: number | null;
  source: string;
  checkedAt: string;
}

interface GridFile {
  networks: GridNetwork[];
}

let gridPromise: Promise<GridNetwork[]> | null = null;

/** Fetched once and memoized, like the OSM brand index (osmBrands.ts) */
export function loadPriceGrid(): Promise<GridNetwork[]> {
  if (!gridPromise) {
    gridPromise = fetch('/ev-prices-fr.json', { signal: AbortSignal.timeout(15000) }).then(
      async (res) => {
        if (!res.ok) throw new Error(`ev price grid HTTP ${res.status}`);
        const json = (await res.json()) as GridFile;
        return Array.isArray(json.networks) ? json.networks : [];
      },
    );
    gridPromise.catch(() => {
      gridPromise = null;
    });
  }
  return gridPromise;
}

/** "TESLA France SARL" → "teslafrancesarl" (accent/space/punct-insensitive) */
function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function matchNetwork(
  grid: GridNetwork[],
  stationId: string,
  names: (string | undefined)[],
): GridNetwork | undefined {
  const id = stationId.toUpperCase();
  const byPrefix = grid.find((n) => n.prefixes.some((p) => p && id.startsWith(p)));
  if (byPrefix) return byPrefix;
  const normed = names.filter((n): n is string => !!n).map(normName);
  return grid.find((n) => n.operators.some((op) => normed.some((x) => x.includes(op))));
}

// ── Cascade ──────────────────────────────────────────────────────────────────
export interface PriceInput {
  stationId: string;
  operator?: string;
  enseigne?: string;
  tarification?: string;
  free: boolean;
  maxPowerKw: number;
  /** date_maj of the station record */
  updatedAt?: string;
}

export function resolveKwhPrice(grid: GridNetwork[], input: PriceInput): KwhPrice | undefined {
  if (input.free) return { value: 0, source: 'free', updatedAt: input.updatedAt };

  const declared = parseTarification(input.tarification);
  if (declared != null) {
    return { value: declared, source: 'declared', updatedAt: input.updatedAt };
  }

  const network = matchNetwork(grid, input.stationId, [input.operator, input.enseigne]);
  if (network) {
    // DC price for fast stations, AC otherwise — fall back to whichever exists
    const preferDc = input.maxPowerKw >= 50;
    const value = preferDc
      ? (network.dcKwh ?? network.acKwh)
      : (network.acKwh ?? network.dcKwh);
    if (value != null) {
      return { value, source: 'grid', updatedAt: network.checkedAt, sourceUrl: network.source };
    }
  }
  return undefined;
}
