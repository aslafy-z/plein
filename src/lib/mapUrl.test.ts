import { describe, expect, it } from 'vitest';
import { mapUrlQuery, parseMapUrl, type MapUrlView } from './mapUrl';

const VIEW: MapUrlView = {
  center: { lat: 43.604652, lng: 1.444209 },
  zoom: 13,
  fuel: 'diesel',
  radius: 5,
  brands: [],
  services: [],
};

describe('mapUrlQuery', () => {
  it('writes the view with readable commas', () => {
    expect(mapUrlQuery(VIEW)).toBe('?ll=43.60465,1.44421&z=13&f=diesel&r=5');
  });

  it('omits the zoom until the map has one', () => {
    expect(mapUrlQuery({ ...VIEW, zoom: null })).toBe('?ll=43.60465,1.44421&f=diesel&r=5');
  });

  it('always writes fuel and radius, so the link does not inherit the reader settings', () => {
    const q = mapUrlQuery({ ...VIEW, fuel: 'e85', radius: 12 });
    expect(q).toContain('f=e85');
    expect(q).toContain('r=12');
  });

  it('carries the brand and service filters, escaping what needs it', () => {
    const q = mapUrlQuery({
      ...VIEW,
      brands: ['E.Leclerc', 'Intermarché'],
      services: ['open24h', 'carWash'],
    });
    expect(q).toContain('b=E.Leclerc,Intermarch%C3%A9');
    expect(q).toContain('s=open24h,carWash');
  });

  it('drops the trailing zeros of round coordinates', () => {
    expect(mapUrlQuery({ ...VIEW, center: { lat: 43.6, lng: 1.4 } })).toContain('ll=43.6,1.4');
  });
});

describe('parseMapUrl', () => {
  it('round-trips a query it wrote itself', () => {
    const view: MapUrlView = {
      ...VIEW,
      center: { lat: 43.6, lng: 1.4 },
      brands: ['E.Leclerc', 'Intermarché'],
      services: ['open24h'],
    };
    expect(parseMapUrl(mapUrlQuery(view))).toEqual({
      center: { lat: 43.6, lng: 1.4 },
      zoom: 13,
      fuel: 'diesel',
      radius: 5,
      brands: ['E.Leclerc', 'Intermarché'],
      services: ['open24h'],
    });
  });

  it('reads nothing from an empty query', () => {
    expect(parseMapUrl('')).toEqual({
      center: null,
      zoom: null,
      fuel: null,
      radius: null,
      brands: null,
      services: null,
    });
  });

  it('ignores coordinates that are not on Earth', () => {
    expect(parseMapUrl('?ll=91,1.4').center).toBeNull();
    expect(parseMapUrl('?ll=43.6,181').center).toBeNull();
    expect(parseMapUrl('?ll=nord,ouest').center).toBeNull();
    expect(parseMapUrl('?ll=43.6').center).toBeNull();
  });

  it('clamps the zoom to what the basemaps serve', () => {
    expect(parseMapUrl('?z=99').zoom).toBe(19);
    expect(parseMapUrl('?z=-4').zoom).toBe(2);
    expect(parseMapUrl('?z=abc').zoom).toBeNull();
  });

  it('only accepts a known fuel', () => {
    expect(parseMapUrl('?f=e85').fuel).toBe('e85');
    expect(parseMapUrl('?f=kerosene').fuel).toBeNull();
  });

  it('keeps the radius a sane whole number of km', () => {
    expect(parseMapUrl('?r=7.4').radius).toBe(7);
    expect(parseMapUrl('?r=0').radius).toBeNull();
    expect(parseMapUrl('?r=9000').radius).toBe(100);
  });

  it('drops unknown service tags and keeps the known ones', () => {
    expect(parseMapUrl('?s=Lavage,Piscine').services).toEqual(['carWash']);
    expect(parseMapUrl('?s=Piscine').services).toBeNull();
  });

  it('round-trips the AdBlue filter', () => {
    const q = mapUrlQuery({ ...VIEW, services: ['carWash', 'adBlue'] });
    expect(q).toContain('s=carWash,adBlue');
    expect(parseMapUrl(q).services).toEqual(['carWash', 'adBlue']);
    // The id is case-sensitive, like every other tag in the link
    expect(parseMapUrl('?s=adblue').services).toBeNull();
  });

  it('bounds the brand list a hand-edited link could carry', () => {
    const many = Array.from({ length: 60 }, (_, i) => `B${i}`).join(',');
    expect(parseMapUrl(`?b=${many}`).brands).toHaveLength(40);
  });

  it('ignores the empty filter lists', () => {
    expect(parseMapUrl('?b=&s=').brands).toBeNull();
    expect(parseMapUrl('?b=&s=').services).toBeNull();
  });
});

describe('legacy links', () => {
  it('still opens on the fuel and filters a pre-rename link was shared with', () => {
    const parsed = parseMapUrl('?ll=43.6,1.4&f=gazole&r=5&s=24%2F24,Lavage')
    expect(parsed.fuel).toBe('diesel')
    expect(parsed.services).toEqual(['open24h', 'carWash'])
  })

  it('drops a fuel no build ever had', () => {
    expect(parseMapUrl('?f=kerosene').fuel).toBeNull()
  })
})
