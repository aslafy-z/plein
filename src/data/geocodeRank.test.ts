import { describe, it, expect } from 'vitest';
import { mergeByKind, rankByKind } from './geocodeRank';
import type { GeocodeResult, PlaceKind } from './types';

const at = (label: string, kind: PlaceKind): GeocodeResult => ({
  label,
  sublabel: '',
  point: { lat: 43.6, lng: 1.44 },
  kind,
});

describe('rankByKind', () => {
  it('offers the town before the street of the same name', () => {
    const out = rankByKind([
      at('Rue de Bayonne', 'street'),
      at('12 rue de Bayonne', 'address'),
      at('Bayonne', 'locality'),
    ]);
    expect(out.map((r) => r.label)).toEqual(['Bayonne', 'Rue de Bayonne', '12 rue de Bayonne']);
  });

  it('keeps the source relevance order inside one kind', () => {
    const out = rankByKind([at('Toulouse', 'locality'), at('Toulon', 'locality')]);
    expect(out.map((r) => r.label)).toEqual(['Toulouse', 'Toulon']);
  });

  it('drops a repeated label, keeping its best-ranked occurrence', () => {
    const out = rankByKind([at('Andorre-la-Vieille', 'street'), at('Andorre-la-Vieille', 'locality')]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('locality');
  });

  it('ranks an unclassified result last', () => {
    const out = rankByKind([at('Truc', 'other'), at('12 rue Machin', 'address')]);
    expect(out.map((r) => r.label)).toEqual(['12 rue Machin', 'Truc']);
  });
});

describe('mergeByKind', () => {
  it('interleaves the sources inside a kind, and keeps the kinds apart', () => {
    const fra = [at('Le Perthus', 'locality'), at('Rue de France', 'street')];
    const esp = [at('La Jonquera', 'locality'), at('Calle Mayor', 'street')];
    expect(mergeByKind([fra, esp]).map((r) => r.label)).toEqual([
      'Le Perthus',
      'La Jonquera',
      'Rue de France',
      'Calle Mayor',
    ]);
  });

  it('lets one source fill a kind the others have nothing in', () => {
    const fra = [at('Toulouse', 'locality'), at('Toulon', 'locality')];
    const esp = [at('Tolosa', 'locality')];
    expect(mergeByKind([fra, esp, []]).map((r) => r.label)).toEqual([
      'Toulouse',
      'Tolosa',
      'Toulon',
    ]);
  });

  it('survives every source coming back empty', () => {
    expect(mergeByKind([[], [], []])).toEqual([]);
    expect(mergeByKind([])).toEqual([]);
  });
});
