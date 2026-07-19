// Andorran geocoder — a static index of the principality's localities.
// Andorra has no public geocoding API (BAN stops at the French border,
// CartoCiudad at the Spanish one) and Nominatim forbids autocomplete use.
// The country is 468 km² with a couple dozen named places, so a local list
// answers instantly, offline, and covers every real destination.
import type { GeocodeProvider, GeocodeResult } from '../types';

const MIN_QUERY = 3;
const MAX_RESULTS = 5;

// [label, parish ('' when the label IS the parish), lat, lng]
const PLACES: ReadonlyArray<readonly [string, string, number, number]> = [
  ['Andorra la Vella', '', 42.5063, 1.5218],
  ['Escaldes-Engordany', '', 42.51, 1.5341],
  ['Encamp', '', 42.5361, 1.5828],
  ['Pas de la Casa', 'Encamp', 42.5427, 1.7333],
  ['Grau Roig', 'Encamp', 42.5314, 1.7057],
  ['Vila', 'Encamp', 42.5326, 1.5771],
  ['Canillo', '', 42.5676, 1.5977],
  ['Soldeu', 'Canillo', 42.5769, 1.6669],
  ['El Tarter', 'Canillo', 42.5794, 1.6522],
  ['Incles', 'Canillo', 42.5735, 1.6597],
  ['Ordino', '', 42.5562, 1.5332],
  ['El Serrat', 'Ordino', 42.6, 1.5386],
  ['La Massana', '', 42.5449, 1.5148],
  ['Arinsal', 'La Massana', 42.5722, 1.4844],
  ['Pal', 'La Massana', 42.5439, 1.4922],
  ['Erts', 'La Massana', 42.556, 1.4972],
  ['Sant Julià de Lòria', '', 42.4637, 1.4913],
  ['Aixovall', 'Sant Julià de Lòria', 42.4757, 1.4899],
  ['Fontaneda', 'Sant Julià de Lòria', 42.4601, 1.4718],
  ['Santa Coloma', 'Andorra la Vella', 42.4952, 1.4983],
  ['La Margineda', 'Andorra la Vella', 42.4794, 1.4859],
];

// « andorre » (French) must land on the capital too
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['andorre', 'Andorra la Vella'],
  ['andorra', 'Andorra la Vella'],
];

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Query matches when a word of the label starts with it, or the label contains it */
function matches(query: string, label: string): boolean {
  const l = normalize(label);
  if (l.includes(query)) return true;
  return l.split(/[\s'-]+/).some((w) => w.startsWith(query));
}

export class AndGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    const q = normalize(query);
    if (q.length < MIN_QUERY) return [];

    const labels = new Set<string>();
    for (const [alias, target] of ALIASES) if (alias.startsWith(q)) labels.add(target);
    for (const [label] of PLACES) if (matches(q, label)) labels.add(label);

    const out: GeocodeResult[] = [];
    for (const [label, parish, lat, lng] of PLACES) {
      if (!labels.has(label)) continue;
      out.push({
        label,
        sublabel: parish ? `Andorre · ${parish}` : 'Andorre',
        point: { lat, lng },
      });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }
}
