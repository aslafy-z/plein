import { describe, expect, it } from 'vitest';
import { LINK_KM, MATCH_KM, gouvPosition, haversineKm, linkStations } from './brandLinks.mjs';

/** Metres, expressed as a latitude offset (≈111.19 km per degree) */
const m = (metres) => metres / 111_194.9;
const at = (lat, lng) => ({ lat, lng });

describe('linkStations', () => {
  const base = at(43.628, 1.48);

  it('links a station to the one free POI within LINK_KM', () => {
    const poi = at(base.lat + m(370), base.lng);
    expect(linkStations([{ id: 1, ...base }], [poi])).toEqual([[1, 0]]);
  });

  it('leaves a station the runtime match already handles alone', () => {
    const poi = at(base.lat + m(100), base.lng);
    expect(haversineKm(base, poi)).toBeLessThan(MATCH_KM);
    expect(linkStations([{ id: 1, ...base }], [poi])).toEqual([]);
  });

  it('never links beyond LINK_KM', () => {
    const poi = at(base.lat + m(LINK_KM * 1000 + 20), base.lng);
    expect(linkStations([{ id: 1, ...base }], [poi])).toEqual([]);
  });

  it('refuses a coin toss between two free POIs', () => {
    const pois = [at(base.lat + m(300), base.lng), at(base.lat - m(400), base.lng)];
    expect(linkStations([{ id: 1, ...base }], pois)).toEqual([]);
  });

  it('skips a POI another station already sits on', () => {
    // The Balma case: Auchan, 450 m off, is the runtime match of the station
    // on its own forecourt, so TotalEnergies is the only free POI left
    const auchan = at(base.lat + m(450), base.lng);
    const total = at(base.lat - m(370), base.lng);
    const stations = [
      { id: 31000004, ...base },
      { id: 31075001, lat: auchan.lat + m(50), lng: auchan.lng },
    ];
    expect(linkStations(stations, [auchan, total])).toEqual([[31000004, 1]]);
  });

  it('drops a POI two unmatched stations both point at', () => {
    const poi = at(base.lat + m(300), base.lng);
    const stations = [
      { id: 1, ...base },
      { id: 2, lat: poi.lat + m(300), lng: poi.lng },
    ];
    expect(linkStations(stations, [poi])).toEqual([]);
  });

  it('skips a station without a usable position', () => {
    expect(linkStations([{ id: 1, lat: NaN, lng: 1 }], [base])).toEqual([]);
  });
});

describe('gouvPosition', () => {
  it('prefers geom, then reads the 1e-5 degree columns', () => {
    expect(gouvPosition({ geom: { lon: 1.48, lat: 43.628 }, latitude: '1', longitude: '2' })).toEqual(
      at(43.628, 1.48),
    );
    expect(gouvPosition({ latitude: '4362800', longitude: '148000' })).toEqual(at(43.628, 1.48));
    expect(gouvPosition({ latitude: '', longitude: '148000' })).toBeNull();
  });
});
