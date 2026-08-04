import { describe, expect, it } from 'vitest';
import {
  coordinateLabel,
  parseRouteUrl,
  routeScreenFromUrl,
  routeUrlQuery,
  type RouteUrlView,
} from './routeUrl';

const VIEW: RouteUrlView = {
  fromPoint: { lat: 43.604652, lng: 1.444209 },
  fromLabel: 'Toulouse',
  fromIsCurrentPosition: false,
  toPoint: { lat: 44.8378, lng: -0.5792 },
  toLabel: 'Bordeaux centre',
  fuel: 'diesel',
  mode: 'balanced',
  vehicle: 'car',
  tank: 50,
  consumption: 6.5,
  startTankPct: 70,
  avoidMotorway: false,
  avoidToll: false,
};

describe('routeUrlQuery', () => {
  it('writes the trip under the stable key spelling', () => {
    // The spelling is a compatibility surface: links carrying these keys are
    // shared, so a renamed key breaks every trip already in the wild.
    expect(routeUrlQuery(VIEW)).toBe(
      '?a=43.60465,1.44421&al=Toulouse&d=44.8378,-0.5792&dl=Bordeaux%20centre' +
        '&f=diesel&m=balanced&v=car&t=50&c=6.5&tp=70',
    );
  });

  it('writes nothing while no endpoint is set — a bare /route stays bare', () => {
    expect(
      routeUrlQuery({
        ...VIEW,
        fromPoint: null,
        fromLabel: '',
        fromIsCurrentPosition: true,
        toPoint: null,
        toLabel: '',
      }),
    ).toBe('');
  });

  it('never writes the departure of a « My position » trip', () => {
    const q = routeUrlQuery({
      ...VIEW,
      fromIsCurrentPosition: true,
    });
    expect(q).not.toContain('a=');
    expect(q).not.toContain('al=');
    expect(q).toContain('d=44.8378,-0.5792');
  });

  it('always writes the trip assumptions, so the link does not inherit the reader settings', () => {
    const q = routeUrlQuery({ ...VIEW, fuel: 'e85', vehicle: 'motorcycle', tank: 15 });
    expect(q).toContain('f=e85');
    expect(q).toContain('v=motorcycle');
    expect(q).toContain('t=15');
    expect(q).toContain('m=balanced');
    expect(q).toContain('tp=70');
  });

  it('writes the avoid flags only when one is on', () => {
    expect(routeUrlQuery(VIEW)).not.toContain('x=');
    expect(routeUrlQuery({ ...VIEW, avoidToll: true })).toContain('x=toll');
    expect(routeUrlQuery({ ...VIEW, avoidMotorway: true, avoidToll: true })).toContain(
      'x=motorway,toll',
    );
  });

  it('carries a typed-but-never-picked endpoint as its label alone', () => {
    const q = routeUrlQuery({ ...VIEW, toPoint: null, toLabel: 'Bordeaux' });
    expect(q).not.toContain('d=');
    expect(q).toContain('dl=Bordeaux');
  });

  it('caps a label a hand-edited link could inflate', () => {
    const q = routeUrlQuery({ ...VIEW, toLabel: 'x'.repeat(500) });
    expect(q).toContain(`dl=${'x'.repeat(120)}&`);
  });
});

describe('parseRouteUrl', () => {
  it('round-trips a query it wrote itself', () => {
    expect(parseRouteUrl(routeUrlQuery(VIEW))).toEqual({
      fromPoint: { lat: 43.60465, lng: 1.44421 },
      fromLabel: 'Toulouse',
      toPoint: { lat: 44.8378, lng: -0.5792 },
      toLabel: 'Bordeaux centre',
      fuel: 'diesel',
      mode: 'balanced',
      vehicle: 'car',
      tank: 50,
      consumption: 6.5,
      startTankPct: 70,
      avoidMotorway: null,
      avoidToll: null,
    });
  });

  it('round-trips the avoid flags', () => {
    const parsed = parseRouteUrl(routeUrlQuery({ ...VIEW, avoidToll: true }));
    expect(parsed.avoidToll).toBe(true);
    expect(parsed.avoidMotorway).toBe(false);
  });

  it('reads nothing from an empty query', () => {
    expect(parseRouteUrl('')).toEqual({
      fromPoint: null,
      fromLabel: null,
      toPoint: null,
      toLabel: null,
      fuel: null,
      mode: null,
      vehicle: null,
      tank: null,
      consumption: null,
      startTankPct: null,
      avoidMotorway: null,
      avoidToll: null,
    });
  });

  it('ignores coordinates that are not on Earth', () => {
    expect(parseRouteUrl('?d=91,1.4').toPoint).toBeNull();
    expect(parseRouteUrl('?d=43.6,181').toPoint).toBeNull();
    expect(parseRouteUrl('?d=nord,ouest').toPoint).toBeNull();
    expect(parseRouteUrl('?a=43.6').fromPoint).toBeNull();
  });

  it('keeps a label whose coordinates were dropped, and vice versa', () => {
    const parsed = parseRouteUrl('?d=91,1.4&dl=Bordeaux');
    expect(parsed.toPoint).toBeNull();
    expect(parsed.toLabel).toBe('Bordeaux');
    expect(parseRouteUrl('?d=44.8,-0.5').toLabel).toBeNull();
  });

  it('only accepts a known strategy', () => {
    expect(parseRouteUrl('?m=price').mode).toBe('price');
    expect(parseRouteUrl('?m=fastest').mode).toBeNull();
  });

  it('only accepts a known vehicle, migrating the legacy id', () => {
    expect(parseRouteUrl('?v=motorcycle').vehicle).toBe('motorcycle');
    expect(parseRouteUrl('?v=moto').vehicle).toBe('motorcycle');
    expect(parseRouteUrl('?v=truck').vehicle).toBeNull();
  });

  it('keeps f meaning what it means on the map, legacy ids included', () => {
    expect(parseRouteUrl('?f=e85').fuel).toBe('e85');
    expect(parseRouteUrl('?f=gazole').fuel).toBe('diesel');
    expect(parseRouteUrl('?f=kerosene').fuel).toBeNull();
  });

  it('clamps the vehicle numbers to what the sliders can set', () => {
    expect(parseRouteUrl('?t=500').tank).toBe(80);
    expect(parseRouteUrl('?t=1').tank).toBe(5);
    expect(parseRouteUrl('?c=99').consumption).toBe(12);
    expect(parseRouteUrl('?tp=200').startTankPct).toBe(100);
    expect(parseRouteUrl('?tp=0').startTankPct).toBe(10);
    expect(parseRouteUrl('?t=abc').tank).toBeNull();
  });

  it('reads the avoid flags as OFF when x names neither', () => {
    expect(parseRouteUrl('?x=motorway').avoidMotorway).toBe(true);
    expect(parseRouteUrl('?x=motorway').avoidToll).toBe(false);
    expect(parseRouteUrl('?x=').avoidMotorway).toBe(false);
    expect(parseRouteUrl('?x=ferry').avoidToll).toBe(false);
  });

  it('caps a label a hand-edited link could inflate', () => {
    expect(parseRouteUrl(`?dl=${'y'.repeat(500)}`).toLabel).toHaveLength(120);
  });
});

describe('routeScreenFromUrl', () => {
  it('lands the ribbon path on the ribbon as soon as a destination is resolvable', () => {
    expect(routeScreenFromUrl(true, parseRouteUrl('?d=44.8,-0.5'))).toBe('route');
    expect(routeScreenFromUrl(true, parseRouteUrl('?dl=Bordeaux'))).toBe('route');
  });

  it('degrades a ribbon link without a destination to the setup form', () => {
    expect(routeScreenFromUrl(true, parseRouteUrl(''))).toBe('routeSetup');
    expect(routeScreenFromUrl(true, parseRouteUrl('?a=43.6,1.4&f=diesel'))).toBe('routeSetup');
    expect(routeScreenFromUrl(true, parseRouteUrl('?d=91,999'))).toBe('routeSetup');
  });

  it('lands /route on the ribbon only when the query spells the whole trip', () => {
    expect(routeScreenFromUrl(false, parseRouteUrl('?a=43.6,1.4&d=44.8,-0.5'))).toBe('route');
    // A destination and no departure opens the form, pre-filled — the
    // departure defaults to « My position », never to an error
    expect(routeScreenFromUrl(false, parseRouteUrl('?d=44.8,-0.5'))).toBe('routeSetup');
    expect(routeScreenFromUrl(false, parseRouteUrl(''))).toBe('routeSetup');
  });
});

describe('coordinateLabel', () => {
  it('renders a point the way the link spells it', () => {
    expect(coordinateLabel({ lat: 43.604652, lng: 1.444209 })).toBe('43.60465, 1.44421');
    expect(coordinateLabel({ lat: 43.6, lng: 1.4 })).toBe('43.6, 1.4');
  });
});
