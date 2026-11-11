import { describe, it, expect } from 'vitest';
import { mergeByKind, queryCoverage, rankByKind } from './geocodeRank';
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

  it('puts a point of interest after the towns and before the streets', () => {
    const out = rankByKind([
      at('Rue de la Gare', 'street'),
      at('Gare de Bayonne', 'poi'),
      at('Bayonne', 'locality'),
    ]);
    expect(out.map((r) => r.kind)).toEqual(['locality', 'poi', 'street']);
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

describe('homonymous places', () => {
  const town = (label: string, sublabel: string, lat: number, lng: number): GeocodeResult => ({
    label,
    sublabel,
    point: { lat, lng },
    kind: 'locality',
  });

  it('keeps every town of one name when the line under it tells them apart', () => {
    const out = rankByKind([
      town('Valence', '26, Drôme, Auvergne-Rhône-Alpes', 44.93, 4.89),
      town('Valence', '82, Tarn-et-Garonne, Occitanie', 44.11, 0.89),
      town('Valence', '16, Charente, Nouvelle-Aquitaine', 45.78, 0.29),
    ]);
    expect(out.map((r) => r.sublabel)).toEqual([
      '26, Drôme, Auvergne-Rhône-Alpes',
      '82, Tarn-et-Garonne, Occitanie',
      '16, Charente, Nouvelle-Aquitaine',
    ]);
  });

  it('collapses the same label and sublabel coming from two sources', () => {
    const fr = [town('Le Perthus', 'Pyrénées-Orientales', 42.464, 2.863)];
    const es = [town('Le Perthus', 'Pyrénées-Orientales', 42.47, 2.87)];
    expect(mergeByKind([fr, es])).toEqual(fr);
  });

  it('collapses one spot two sources describe in their own words', () => {
    const fr = [town('Le Perthus', '66, Pyrénées-Orientales, Occitanie', 42.464, 2.863)];
    const es = [town('Le Perthus', 'Girona', 42.4645, 2.8635)];
    expect(mergeByKind([fr, es])).toEqual(fr);
  });

  it('keeps a label two countries share', () => {
    const fr = [town('Valence', '26, Drôme, Auvergne-Rhône-Alpes', 44.93, 4.89)];
    const pt: GeocodeResult[] = [{ ...town('Valence', '', 42.03, -8.64), country: 'pt' }];
    const ad: GeocodeResult[] = [{ ...town('Valence', '', 42.5, 1.52), country: 'ad' }];
    expect(mergeByKind([fr, ad, pt])).toHaveLength(3);
  });
});

describe('mergeByKind', () => {
  it('interleaves the sources inside a kind, and keeps the kinds apart', () => {
    const fr = [at('Le Perthus', 'locality'), at('Rue de France', 'street')];
    const es = [at('La Jonquera', 'locality'), at('Calle Mayor', 'street')];
    expect(mergeByKind([fr, es]).map((r) => r.label)).toEqual([
      'Le Perthus',
      'La Jonquera',
      'Rue de France',
      'Calle Mayor',
    ]);
  });

  it('lets one source fill a kind the others have nothing in', () => {
    const fr = [at('Toulouse', 'locality'), at('Toulon', 'locality')];
    const es = [at('Tolosa', 'locality')];
    expect(mergeByKind([fr, es, []]).map((r) => r.label)).toEqual([
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

describe('queryCoverage', () => {
  const said = (label: string, sublabel = ''): GeocodeResult => ({ ...at(label, 'other'), sublabel });

  it('counts the words of the query a result says, accents and case aside', () => {
    expect(queryCoverage('aeroport toulouse', said('Aéroport de Toulouse-Blagnac'))).toBe(1);
    expect(queryCoverage('gare matabiau', said('Rue de la Gare'))).toBe(0.5);
    expect(queryCoverage('toulouze', said('Toulouse'))).toBe(0);
  });

  it('reads the line under the label too', () => {
    expect(queryCoverage('bayonne 64', said('Bayonne', '64, Pyrénées-Atlantiques'))).toBe(1);
  });

  it('takes only the word being typed as a prefix', () => {
    expect(queryCoverage('aeroport toul', said('Aéroport de Toulouse-Blagnac'))).toBe(1);
    // « arria » is finished: it is not the start of « Arriaga »
    expect(queryCoverage('rue arria ly', said('Rua Manuel de Arriaga'))).toBe(0);
  });

  it('is zero for an empty query', () => {
    expect(queryCoverage('  ', said('Toulouse'))).toBe(0);
  });
});

describe('ranking against the query', () => {
  it('puts the address saying the whole query above nearer kinds that do not', () => {
    const fr = [at('Rue Arria Ly 31200 Toulouse', 'street'), at('1 Rue Arria Ly 31200 Toulouse', 'address')];
    const pt = [
      at('Lavandaria e Engomadoria', 'poi'),
      at('Rua Manuel de Arriaga', 'street'),
      at('1 Rua Doutor Manuel de Arriaga', 'address'),
    ];
    expect(mergeByKind([fr, pt], '1 rue arria ly').map((r) => r.label)).toEqual([
      '1 Rue Arria Ly 31200 Toulouse',
      'Rue Arria Ly 31200 Toulouse',
      '1 Rua Doutor Manuel de Arriaga',
      'Lavandaria e Engomadoria',
      'Rua Manuel de Arriaga',
    ]);
  });

  it('keeps the kind order between results that answer the query equally', () => {
    const out = rankByKind(
      [at('Rue de Bayonne', 'street'), at('Gare de Bayonne', 'poi'), at('Bayonne', 'locality')],
      'bayonne',
    );
    expect(out.map((r) => r.label)).toEqual(['Bayonne', 'Gare de Bayonne', 'Rue de Bayonne']);
  });

  it('leaves the list as it was when no word matches', () => {
    const out = rankByKind([at('Toulouse', 'locality'), at('Toulon', 'locality')], 'tuluz');
    expect(out.map((r) => r.label)).toEqual(['Toulouse', 'Toulon']);
  });
});
