// Andorran geocoder — a static index of the principality's localities.
// Andorra has no public geocoding API (BAN stops at the French border,
// CartoCiudad at the Spanish one) and Nominatim forbids autocomplete use.
// The country is 468 km² with a couple dozen named places, so a local list
// answers instantly, offline, and covers every real destination.
import type { GeocodeProvider, GeocodeResult } from '../types';

const MIN_QUERY = 3;
const MAX_RESULTS = 5;

// [label, parish ('' when the label IS the parish), lat, lng]
// Every place node of OpenStreetMap tagged town/village in Andorra, plus the
// settled hamlets (seasonal barn clusters and lone farmsteads are skipped).
// Coordinates © OpenStreetMap contributors (ODbL).
const PLACES: ReadonlyArray<readonly [string, string, number, number]> = [
  ['Andorra la Vella', '', 42.5069, 1.5212],
  ['Santa Coloma', 'Andorra la Vella', 42.495, 1.4997],
  ['La Margineda', 'Andorra la Vella', 42.487, 1.4914],
  ['Escaldes-Engordany', '', 42.509, 1.5404],
  ['Engordany', 'Escaldes-Engordany', 42.5121, 1.5419],
  ['Engolasters', 'Escaldes-Engordany', 42.5105, 1.5592],
  ['Els Vilars', 'Escaldes-Engordany', 42.5168, 1.5414],
  ['Encamp', '', 42.536, 1.5836],
  ['Pas de la Casa', 'Encamp', 42.5447, 1.7335],
  ['Grau Roig', 'Encamp', 42.5369, 1.7018],
  ['Vila', 'Encamp', 42.5319, 1.5666],
  ['Les Bons', 'Encamp', 42.5385, 1.5845],
  ['Canillo', '', 42.5668, 1.5978],
  ['Soldeu', 'Canillo', 42.5769, 1.6683],
  ['El Tarter', 'Canillo', 42.5803, 1.6497],
  ['Incles', 'Canillo', 42.5735, 1.6597],
  ['Ransol', 'Canillo', 42.5817, 1.6375],
  ["L'Aldosa de Canillo", 'Canillo', 42.5796, 1.6278],
  ['Els Plans', 'Canillo', 42.5821, 1.633],
  ["Les Bordes d'Envalira", 'Canillo', 42.56, 1.6849],
  ['Meritxell', 'Canillo', 42.5536, 1.5906],
  ['Prats', 'Canillo', 42.5606, 1.5937],
  ['El Forn', 'Canillo', 42.5621, 1.6028],
  ['Ordino', '', 42.5562, 1.5335],
  ['El Serrat', 'Ordino', 42.6196, 1.5389],
  ['La Cortinada', 'Ordino', 42.5756, 1.5193],
  ['Llorts', 'Ordino', 42.5963, 1.5262],
  ['Arans', 'Ordino', 42.5825, 1.5181],
  ['Ansalonga', 'Ordino', 42.569, 1.5222],
  ['Sornàs', 'Ordino', 42.5649, 1.5274],
  ['Segudet', 'Ordino', 42.5571, 1.5381],
  ['La Massana', '', 42.5442, 1.5164],
  ['Arinsal', 'La Massana', 42.5721, 1.4844],
  ['Pal', 'La Massana', 42.5458, 1.476],
  ['Erts', 'La Massana', 42.5615, 1.4966],
  ['Xixerella', 'La Massana', 42.5531, 1.4879],
  ['Escàs', 'La Massana', 42.5469, 1.509],
  ['Anyós', 'La Massana', 42.5344, 1.5255],
  ['Sispony', 'La Massana', 42.5339, 1.5156],
  ["L'Aldosa de la Massana", 'La Massana', 42.5437, 1.5228],
  ['Sant Julià de Lòria', '', 42.4669, 1.4923],
  ['Aixovall', 'Sant Julià de Lòria', 42.477, 1.4888],
  ['Aixàs', 'Sant Julià de Lòria', 42.4826, 1.4641],
  ['Aixirivall', 'Sant Julià de Lòria', 42.462, 1.5016],
  ['Auvinyà', 'Sant Julià de Lòria', 42.4537, 1.4921],
  ['Bixessarri', 'Sant Julià de Lòria', 42.4836, 1.4567],
  ['Certers', 'Sant Julià de Lòria', 42.4761, 1.5062],
  ['Fontaneda', 'Sant Julià de Lòria', 42.4543, 1.464],
  ['Juberri', 'Sant Julià de Lòria', 42.4392, 1.4918],
  ['Llumeneres', 'Sant Julià de Lòria', 42.4722, 1.5117],
  ['Nagol', 'Sant Julià de Lòria', 42.4705, 1.4996],
];

// « andorre » (French) must land on the capital too; Auvinyà is also
// spelled Aubinyà.
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['andorre', 'Andorra la Vella'],
  ['andorra', 'Andorra la Vella'],
  ['aubinya', 'Auvinyà'],
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
