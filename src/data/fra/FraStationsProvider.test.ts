import { describe, expect, it } from 'vitest';
import {
  parseClock,
  parseCoords,
  parseOpeningHours,
  parsePrices,
  parsePriceField,
  parseServices,
} from './FraStationsProvider';

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

describe('parsePrices', () => {
  it('reads the per-fuel columns with their update stamps', () => {
    expect(
      parsePrices({
        gazole_prix: '1.789',
        gazole_maj: '2026-07-19T05:00:00+02:00',
        sp98_prix: 1.929,
        e10_prix: null,
      }),
    ).toEqual({
      diesel: { value: 1.789, updatedAt: '2026-07-19T05:00:00+02:00' },
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
