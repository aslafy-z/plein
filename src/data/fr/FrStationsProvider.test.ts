import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FrStationsProvider,
  deriveTags,
  frDatasetId,
  parseClock,
  parseCoords,
  parseOpeningHours,
  parsePrices,
  parsePriceField,
  parseServices,
  parseFluxTimestamp,
} from './FrStationsProvider';
import type { GeoPoint } from '../../lib/geo';
import { haversineKm, nearestOnPolyline } from '../../lib/geo';

// The gouv flux is schema-loose: the same column arrives as a number, a
// string, a JSON string or not at all, depending on the record. These pin the
// shapes seen on the live endpoint (`npm run verify:live`) so a parser
// regression fails in CI instead of silently emptying the map.

describe('parseCoords', () => {
  it('reads the lon/lat pair of the geom object', () => {
    expect(parseCoords({ geom: { lon: 1.4442, lat: 43.6045 } })).toEqual({
      lat: 43.6045,
      lng: 1.4442,
    });
  });

  it('reads GeoJSON coordinates, nested or flat, in lon/lat order', () => {
    expect(parseCoords({ geom: { geometry: { coordinates: [1.4442, 43.6045] } } })).toEqual({
      lat: 43.6045,
      lng: 1.4442,
    });
    expect(parseCoords({ geom: { coordinates: ['1.4442', '43.6045'] } })).toEqual({
      lat: 43.6045,
      lng: 1.4442,
    });
  });

  it('falls back to the flat latitude/longitude columns', () => {
    expect(parseCoords({ latitude: '43.6045', longitude: '1.4442' })).toEqual({
      lat: 43.6045,
      lng: 1.4442,
    });
  });

  it('falls back to the flat columns when geom carries nothing usable', () => {
    expect(parseCoords({ geom: {}, latitude: 43.6045, longitude: 1.4442 })).toEqual({
      lat: 43.6045,
      lng: 1.4442,
    });
    expect(parseCoords({ geom: { coordinates: [1.4442] }, latitude: 43.6045, longitude: 1.4442 })).toEqual(
      { lat: 43.6045, lng: 1.4442 },
    );
  });

  it('rescales the ×1e5 flat coordinates of the raw flux', () => {
    const p = parseCoords({ latitude: 4574060, longitude: 494330 });
    expect(p?.lat).toBeCloseTo(45.7406, 6);
    expect(p?.lng).toBeCloseTo(4.9433, 6);
  });

  it('rescales a negative longitude with the latitude', () => {
    const p = parseCoords({ latitude: '4832000', longitude: '-176000' });
    expect(p?.lat).toBeCloseTo(48.32, 6);
    expect(p?.lng).toBeCloseTo(-1.76, 6);
  });

  it('leaves an already-decimal pair alone', () => {
    // Only |lat| > 90 triggers the rescale — a plausible pair must not move
    expect(parseCoords({ latitude: 45.7406, longitude: 4.9433 })).toEqual({
      lat: 45.7406,
      lng: 4.9433,
    });
  });

  it('rejects anything still out of range after the rescale', () => {
    expect(parseCoords({ latitude: 999999999, longitude: 1 })).toBe(null);
    expect(parseCoords({ latitude: 45.7406, longitude: 999 })).toBe(null);
  });

  it('returns null when neither shape supplies a pair', () => {
    expect(parseCoords({})).toBe(null);
    expect(parseCoords({ latitude: 43.6045 })).toBe(null);
    expect(parseCoords({ latitude: 'n/a', longitude: 'n/a' })).toBe(null);
  });
});

describe('parsePriceField', () => {
  it('parses a JSON string holding an array', () => {
    expect(
      parsePriceField('[{"@nom":"Gazole","@valeur":"1.789","@maj":"2026-07-19T05:00:00"}]'),
    ).toEqual([{ name: 'Gazole', value: 1.789, maj: '2026-07-19T05:00:00' }]);
  });

  it('wraps a lone object, whether JSON-encoded or already parsed', () => {
    const expected = [{ name: 'SP98', value: 1.929, maj: undefined }];
    expect(parsePriceField('{"@nom":"SP98","@valeur":1.929}')).toEqual(expected);
    expect(parsePriceField({ '@nom': 'SP98', '@valeur': 1.929 })).toEqual(expected);
  });

  it('accepts the unprefixed field names', () => {
    expect(parsePriceField([{ nom: 'E85', valeur: '0,789', maj: '2026-07-19' }])).toEqual([
      { name: 'E85', value: 0.789, maj: '2026-07-19' },
    ]);
  });

  it('prefers the @-prefixed name over the bare one', () => {
    expect(parsePriceField([{ '@nom': 'Gazole', nom: 'SP95', '@valeur': 1.7 }])).toEqual([
      { name: 'Gazole', value: 1.7, maj: undefined },
    ]);
  });

  it('drops entries missing a name or a value', () => {
    expect(parsePriceField([{ '@valeur': 1.7 }, { '@nom': 'Gazole' }, null, 'Gazole', 3])).toEqual(
      [],
    );
  });

  it('returns nothing for an empty, absent or malformed field', () => {
    expect(parsePriceField('')).toEqual([]);
    expect(parsePriceField('   ')).toEqual([]);
    expect(parsePriceField(undefined)).toEqual([]);
    expect(parsePriceField('{not json')).toEqual([]);
    expect(parsePriceField(42)).toEqual([]);
  });
});

describe('parseFluxTimestamp', () => {
  it('reads the ODS « +00:00 » stamp as the Paris wall clock it really is', () => {
    // Winter: Paris is UTC+1
    expect(parseFluxTimestamp('2026-11-08T00:01:00+00:00')).toBe('2026-11-07T23:01:00.000Z');
    // Summer: Paris is UTC+2
    expect(parseFluxTimestamp('2026-07-19T05:00:00+00:00')).toBe('2026-07-19T03:00:00.000Z');
  });

  it('reads the zoneless XML / prix-field form the same way', () => {
    expect(parseFluxTimestamp('2026-11-08 00:01:00')).toBe('2026-11-07T23:01:00.000Z');
    expect(parseFluxTimestamp('2026-07-19T05:00')).toBe('2026-07-19T03:00:00.000Z');
    // A bare day is midnight in Paris
    expect(parseFluxTimestamp('2026-07-19')).toBe('2026-07-18T22:00:00.000Z');
  });

  it('keeps the digits whatever offset the instant is rendered in', () => {
    // The same mislabelled instant, asked for with timezone=Europe/Paris
    expect(parseFluxTimestamp('2026-11-08T01:01:00+01:00')).toBe('2026-11-07T23:01:00.000Z');
  });

  it('lands each side of the DST switches on the right offset', () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST
    expect(parseFluxTimestamp('2026-03-29 01:30:00')).toBe('2026-03-29T00:30:00.000Z');
    expect(parseFluxTimestamp('2026-03-29 03:30:00')).toBe('2026-03-29T01:30:00.000Z');
    // 2026-10-25: 03:00 CEST falls back to 02:00 CET
    expect(parseFluxTimestamp('2026-10-25 01:30:00')).toBe('2026-10-24T23:30:00.000Z');
    expect(parseFluxTimestamp('2026-10-25 03:30:00')).toBe('2026-10-25T02:30:00.000Z');
  });

  it('returns undefined for an absent or unreadable stamp', () => {
    expect(parseFluxTimestamp(undefined)).toBeUndefined();
    expect(parseFluxTimestamp('')).toBeUndefined();
    expect(parseFluxTimestamp('hier')).toBeUndefined();
    expect(parseFluxTimestamp(null)).toBeUndefined();
  });
});

describe('parsePrices', () => {
  it('reads the per-fuel columns with their update stamps', () => {
    expect(
      parsePrices({
        gazole_prix: '1.789',
        // ODS renders the Paris wall clock as UTC: 05:00 in July is 03:00Z
        gazole_maj: '2026-07-19T05:00:00+00:00',
        sp98_prix: 1.929,
        e10_prix: null,
      }),
    ).toEqual({
      diesel: { value: 1.789, updatedAt: '2026-07-19T03:00:00.000Z' },
      unleaded98: { value: 1.929, updatedAt: undefined },
    });
  });

  it('clamps to a plausible €/L range', () => {
    // 0.5 … 3.5 €/L — a 0 or a centime-denominated 178.9 is not a price
    expect(parsePrices({ gazole_prix: 0, sp98_prix: 178.9, e10_prix: 0.49, sp95_prix: 3.51 })).toEqual(
      {},
    );
    expect(parsePrices({ gazole_prix: 0.5, sp98_prix: 3.5 })).toEqual({
      diesel: { value: 0.5, updatedAt: undefined },
      unleaded98: { value: 3.5, updatedAt: undefined },
    });
  });

  it('falls back to the aggregated prix field when no column has a price', () => {
    expect(
      parsePrices({
        prix: '[{"@nom":"Gazole","@valeur":"1.789"},{"@nom":"SP95-E10","@valeur":"1.849"},' +
          '{"@nom":"SP98","@valeur":"1.929"},{"@nom":"GPLc","@valeur":"0.999"}]',
      }),
    ).toEqual({
      diesel: { value: 1.789, updatedAt: undefined },
      e10: { value: 1.849, updatedAt: undefined },
      unleaded98: { value: 1.929, updatedAt: undefined },
      lpg: { value: 0.999, updatedAt: undefined },
    });
  });

  it('ignores the prix field as soon as one column answered', () => {
    expect(
      parsePrices({
        gazole_prix: 1.789,
        prix: '[{"@nom":"SP98","@valeur":"1.929"}]',
      }),
    ).toEqual({ diesel: { value: 1.789, updatedAt: undefined } });
  });

  it('clamps the prix fallback too, and keeps the first reading of a fuel', () => {
    expect(
      parsePrices({
        prix: [
          { '@nom': 'Gazole', '@valeur': 1.789 },
          { '@nom': 'Gazole excellium', '@valeur': 1.999 },
          { '@nom': 'SP95', '@valeur': 178.9 },
        ],
      }),
    ).toEqual({ diesel: { value: 1.789, updatedAt: undefined } });
  });

  it('returns nothing when the record carries no price at all', () => {
    expect(parsePrices({})).toEqual({});
    expect(parsePrices({ prix: '[]' })).toEqual({});
  });
});

describe('parseServices', () => {
  it('splits the `//`-joined form', () => {
    expect(parseServices({ services: 'Boutique alimentaire//Lavage automatique// Gonflage ' })).toEqual(
      ['Boutique alimentaire', 'Lavage automatique', 'Gonflage'],
    );
  });

  it('reads the {"service":[…]} JSON string', () => {
    expect(parseServices({ services: '{"service":["Boutique alimentaire","Lavage automatique"]}' })).toEqual(
      ['Boutique alimentaire', 'Lavage automatique'],
    );
  });

  it('reads a JSON array, encoded or already parsed', () => {
    expect(parseServices({ services: '["Boutique","Lavage"]' })).toEqual(['Boutique', 'Lavage']);
    expect(parseServices({ services: ['Boutique', 'Lavage'] })).toEqual(['Boutique', 'Lavage']);
  });

  it('unwraps a single-service object', () => {
    expect(parseServices({ services: { service: ['Boutique'] } })).toEqual(['Boutique']);
    // `service` as a lone string is not a list — nothing to read
    expect(parseServices({ services: { service: 'Boutique' } })).toEqual([]);
  });

  it('falls back to `//` splitting when the JSON-looking string does not parse', () => {
    expect(parseServices({ services: '{Boutique//Lavage' })).toEqual(['{Boutique', 'Lavage']);
  });

  it('returns nothing for an empty or absent field', () => {
    expect(parseServices({})).toEqual([]);
    expect(parseServices({ services: '' })).toEqual([]);
    expect(parseServices({ services: '  ' })).toEqual([]);
    expect(parseServices({ services: '//' })).toEqual([]);
  });
});

describe('deriveTags', () => {
  // The gouv flux's service vocabulary is closed and free-text. These are the
  // strings the tag rules actually key on, plus the two « additifs » ones the
  // AdBlue filter must NOT be fooled by.
  const VOCABULARY = [
    'Boutique alimentaire',
    'Boutique non alimentaire',
    'Lavage automatique',
    'Lavage manuel',
    'Gonflage',
    'Station de gonflage',
    'Vente de gaz domestique',
    "Vente d'additifs carburants",
    'Carburant additivé',
    'Piste poids lourds',
    'Automate CB 24/24',
    'Restauration à emporter',
    'Toilettes publiques',
    'Aire de camping-cars',
    'GNV',
  ]

  it('never claims AdBlue: the source publishes no such signal', () => {
    // One at a time, and all of them at once — no combination may produce it
    for (const service of VOCABULARY) {
      expect(deriveTags([service], {})).not.toContain('adBlue')
    }
    expect(deriveTags(VOCABULARY, {})).not.toContain('adBlue')
  })

  it('still reads « Carburant additivé » as « additives »', () => {
    expect(deriveTags(['Carburant additivé'], {})).toContain('additives')
    // The `/additiv/i` rule keys on the ACCENTED adjective, so the bottled
    // « additifs » of the shop have never set the tag — documenting the rule
    // as it stands, not endorsing it
    expect(deriveTags(["Vente d'additifs carburants"], {})).toEqual([])
    // « Piste poids lourds » correlates with an AdBlue lane but asserts nothing
    expect(deriveTags(['Piste poids lourds'], {})).toEqual([])
  })
})

describe('parseClock', () => {
  it('reads the dotted, colon and h separators', () => {
    expect(parseClock('08.00')).toBe(480);
    expect(parseClock('8:30')).toBe(510);
    expect(parseClock('19h45')).toBe(1185);
    expect(parseClock('24.00')).toBe(1440);
  });

  it('rejects impossible and malformed clocks', () => {
    expect(parseClock('25.00')).toBe(null);
    expect(parseClock('08.60')).toBe(null);
    expect(parseClock('8:5')).toBe(null);
    expect(parseClock('0800')).toBe(null);
    expect(parseClock('')).toBe(null);
    expect(parseClock(undefined)).toBe(null);
    expect(parseClock(800)).toBe(null);
  });
});

describe('parseOpeningHours', () => {
  it('flags a 24/24 automat from the dedicated column', () => {
    expect(parseOpeningHours({ horaires_automate_24_24: 'Oui' })).toEqual({ auto24: true, days: {} });
    expect(parseOpeningHours({ horaires_automate_24_24: 'Non' })).toBe(undefined);
  });

  it('flags a 24/24 automat from the @automate-24-24 attribute', () => {
    expect(parseOpeningHours({ horaires: '{"@automate-24-24":"1"}' })).toEqual({
      auto24: true,
      days: {},
    });
    expect(parseOpeningHours({ horaires: '{"@automate-24-24":""}' })).toBe(undefined);
  });

  it('reads the day ranges of the horaires JSON string', () => {
    const hours = parseOpeningHours({
      horaires:
        '{"@automate-24-24":"","jour":[' +
        '{"@id":"1","@nom":"Lundi","@ferme":"","horaire":{"@ouverture":"08.00","@fermeture":"19.30"}},' +
        '{"@id":"7","@nom":"Dimanche","@ferme":"1"}]}',
    });
    expect(hours).toEqual({
      auto24: false,
      days: {
        1: { closed: false, ranges: [{ open: 480, close: 1170 }] },
        7: { closed: true, ranges: [] },
      },
    });
  });

  it('keeps every range of a split day', () => {
    const hours = parseOpeningHours({
      horaires: {
        jour: {
          '@id': 3,
          horaire: [
            { '@ouverture': '08.00', '@fermeture': '12.30' },
            { ouverture: '14.00', fermeture: '19.00' },
          ],
        },
      },
    });
    expect(hours?.days[3]).toEqual({
      closed: false,
      ranges: [
        { open: 480, close: 750 },
        { open: 840, close: 1140 },
      ],
    });
  });

  it('drops the "01.00 → 01.00" placeholder, leaving the day unknown', () => {
    expect(
      parseOpeningHours({
        horaires:
          '{"jour":[{"@id":"2","@ferme":"","horaire":{"@ouverture":"01.00","@fermeture":"01.00"}}]}',
      }),
    ).toBe(undefined);
  });

  it('keeps a day closed even when it carries a placeholder range', () => {
    expect(
      parseOpeningHours({
        horaires:
          '{"jour":[{"@id":"7","@ferme":"1","horaire":{"@ouverture":"01.00","@fermeture":"01.00"}}]}',
      }),
    ).toEqual({ auto24: false, days: { 7: { closed: true, ranges: [] } } });
  });

  it('ignores days outside 1…7 and unusable entries', () => {
    expect(
      parseOpeningHours({
        horaires:
          '{"jour":[{"@id":"0","@ferme":"1"},{"@id":"8","@ferme":"1"},{"@id":"x","@ferme":"1"},null]}',
      }),
    ).toBe(undefined);
  });

  it('returns unknown when the field is absent or unparseable', () => {
    expect(parseOpeningHours({})).toBe(undefined);
    expect(parseOpeningHours({ horaires: '' })).toBe(undefined);
    expect(parseOpeningHours({ horaires: '{not json' })).toBe(undefined);
    expect(parseOpeningHours({ horaires: '{"jour":[]}' })).toBe(undefined);
  });

  it('keeps the days of a station whose automat column also says 24/24', () => {
    expect(
      parseOpeningHours({
        horaires_automate_24_24: 'Oui',
        horaires: '{"jour":[{"@id":"1","horaire":{"@ouverture":"08.00","@fermeture":"20.00"}}]}',
      }),
    ).toEqual({
      auto24: true,
      days: { 1: { closed: false, ranges: [{ open: 480, close: 1200 }] } },
    });
  });
});

describe('frDatasetId', () => {
  it('reads the numeric dataset id off the prefixed form', () => {
    expect(frDatasetId('fr-80570001')).toBe(80570001);
  });

  it('rejects coordinate-fallback ids and other countries', () => {
    expect(frDatasetId('fr-43.60000,1.44000')).toBeNull();
    expect(frDatasetId('es-1234')).toBeNull();
    expect(frDatasetId('su')).toBeNull();
  });
});

describe('getStationsByIds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends one numeric in-list and parses the records back', async () => {
    // The flux types `id` as an int — a quoted list is rejected upstream
    // (IncompatibleTypesInComparisonFilter), so the list must stay bare.
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          total_count: 1,
          results: [
            {
              id: 80570001,
              ville: 'Dargnies',
              geom: { lat: 50.06, lon: 1.52 },
              gazole_prix: '1.80',
            },
          ],
        }),
      };
    });

    const stations = await new FrStationsProvider().getStationsByIds([
      'fr-80570001',
      'fr-43.60000,1.44000', // names no dataset row — dropped from the list
      'es-1234', // another country's scheme — ignored
    ]);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0], 'http://localhost');
    expect(url.searchParams.get('where')).toBe('id in (80570001)');
    expect(stations.map((s) => s.id)).toEqual(['fr-80570001']);
    expect(stations[0].prices.diesel?.value).toBe(1.8);
  });

  it('makes no request at all when no id is expressible', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('must not be called');
    });
    expect(await new FrStationsProvider().getStationsByIds(['fr-1.0,2.0', 'ad-7'])).toEqual([]);
  });
});

describe('getStationsAlong', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface Disc {
    center: GeoPoint;
    radiusKm: number;
  }

  /**
   * A stand-in for the flux: answers `within_distance` discs out of `dataset`,
   * one `limit`/`offset` page at a time, and records every disc asked for.
   * Without an `order_by` the pages come back in a shifting order, like the
   * live endpoint is free to do.
   */
  function stubFlux(dataset: { id: number; lat: number; lng: number }[]) {
    const discs: Disc[] = [];
    let requests = 0;
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(String(input), 'http://localhost');
      // The OSM brand index is not what these tests are about
      if (!url.pathname.includes('/records')) throw new Error('offline');
      requests++;
      const m = /POINT\(([-\d.]+) ([-\d.]+)\)', ([\d.]+)km/.exec(url.searchParams.get('where') ?? '');
      if (!m) throw new Error(`unexpected where: ${url.search}`);
      const center = { lat: Number(m[2]), lng: Number(m[1]) };
      const radiusKm = Number(m[3]);
      if (!discs.some((d) => d.center.lat === center.lat && d.center.lng === center.lng)) {
        discs.push({ center, radiusKm });
      }
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const inDisc = dataset.filter((s) => haversineKm(s, center) <= radiusKm);
      if (url.searchParams.get('order_by') === 'id') inDisc.sort((a, b) => a.id - b.id);
      else inDisc.sort((a, b) => ((a.id * 7 + offset) % 13) - ((b.id * 7 + offset) % 13));
      return {
        ok: true,
        json: async () => ({
          total_count: inDisc.length,
          results: inDisc.slice(offset, offset + limit).map((s) => ({
            id: s.id,
            ville: 'Ville',
            geom: { lat: s.lat, lon: s.lng },
            gazole_prix: '1.80',
          })),
        }),
      };
    });
    return { discs, requestCount: () => requests };
  }

  /** A dense polyline heading east then north-east, ~1 km between vertices */
  function syntheticRoute(km: number): GeoPoint[] {
    const line: GeoPoint[] = [];
    let lat = 43.6;
    let lng = 1.44;
    for (let i = 0; i <= km; i++) {
      line.push({ lat, lng });
      // A bend every 90 km, so the route is not one straight line
      if (Math.floor(i / 90) % 2 === 0) lng += 1 / 80.6;
      else {
        lat += 0.7 / 111.2;
        lng += 0.7 / 80.6;
      }
    }
    return line;
  }

  it('fetches every page of a disc holding more than one', async () => {
    // 250 stations packed around the middle of a short route: one disc, three pages
    const route = syntheticRoute(30);
    const mid = route[15];
    const dataset = Array.from({ length: 250 }, (_, i) => ({
      id: 31000001 + i,
      lat: mid.lat + ((i % 10) - 5) * 0.002,
      lng: mid.lng + (Math.floor(i / 10) - 12) * 0.002,
    }));
    const flux = stubFlux(dataset);

    const stations = await new FrStationsProvider().getStationsAlong(route, 5);

    expect(new Set(stations.map((s) => s.id)).size).toBe(250);
    expect(stations).toHaveLength(250);
    // Three pages per disc (100 + 100 + 50), and not one request more
    expect(flux.requestCount()).toBe(flux.discs.length * 3);
  });

  it.each([120, 400, 556, 1000])(
    'covers every vertex of a %i km route with a sample disc, destination included',
    async (km) => {
      const route = syntheticRoute(km);
      const corridorKm = 5;
      // One station right on every fifth vertex, the destination among them
      const dataset = route
        .filter((_, i) => i % 5 === 0 || i === route.length - 1)
        .map((p, i) => ({ id: 1000 + i, lat: p.lat, lng: p.lng }));
      const flux = stubFlux(dataset);

      const stations = await new FrStationsProvider().getStationsAlong(route, corridorKm);

      expect(flux.discs.length).toBeLessThanOrEqual(10);
      for (const v of route) {
        // The disc must reach the whole corridor around the vertex, not just the vertex
        const covered = flux.discs.some((d) => haversineKm(v, d.center) + corridorKm <= d.radiusKm);
        expect(covered).toBe(true);
      }
      const dest = route[route.length - 1];
      expect(flux.discs.some((d) => haversineKm(dest, d.center) < 0.001)).toBe(true);

      const expected = dataset.filter((s) => nearestOnPolyline(s, route).distKm <= corridorKm);
      expect(stations.map((s) => s.id).sort()).toEqual(expected.map((s) => `fr-${s.id}`).sort());
      // Ten discs at most, each paged a handful of times: nothing runs away
      expect(flux.requestCount()).toBeLessThanOrEqual(60);
    },
  );
});
