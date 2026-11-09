// Sharing — the payloads handed to the Web Share API (or, when it is missing,
// to the clipboard): a station fiche, the map view itself, and a planned trip.
// The wording is catalog copy like any other: one whole sentence per variant
// (`share_*`), so each language keeps its own word order.
import { m } from '../paraglide/messages.js';
import { fmtPrice } from './format';
import { mapUrlQuery, type MapUrlView } from './mapUrl';
import { routeUrlQuery, type RouteUrlView } from './routeUrl';

export type ShareData = {
  title: string;
  text: string;
  url: string;
};

/** The station bits a share needs — kept minimal so route stations fit too */
export type ShareableStation = {
  id: string;
  name: string;
  city?: string;
};

function base(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/**
 * Deep link + wording for a station. `origin` is `location.origin`; the path
 * is the same /station/:id the app already boots on, so a shared link opens
 * the fiche directly.
 */
export function stationShareData(
  station: ShareableStation,
  origin: string,
  price?: { fuelLabel: string; value: number } | null,
): ShareData {
  const url = `${base(origin)}/station/${encodeURIComponent(station.id)}`;
  const { name, city } = station;
  const title = m.share_station_title({ name });
  if (!price) {
    const text = city ? m.share_station_plain_city({ name, city }) : m.share_station_plain({ name });
    return { title, text, url };
  }
  const priced = { name, fuel: price.fuelLabel, price: fmtPrice(price.value) };
  const text = city
    ? m.share_station_priced_city({ ...priced, city })
    : m.share_station_priced(priced);
  return { title, text, url };
}

/**
 * Deep link + wording for the map itself: the query string carries the area,
 * the zoom and the filters, so the link reopens the very same view. `place`
 * is the searched place name when there is one — a free pan has none.
 */
export function mapViewShareData(
  view: MapUrlView,
  origin: string,
  ctx: { fuelLabel: string; place?: string | null },
): ShareData {
  const url = `${base(origin)}/${mapUrlQuery(view)}`;
  const fuel = ctx.fuelLabel;
  if (ctx.place) {
    const named = { fuel, place: ctx.place };
    return { title: m.share_map_around_title(named), text: m.share_map_around(named), url };
  }
  return { title: m.share_map_area_title({ fuel }), text: m.share_map_area({ fuel }), url };
}

/**
 * Deep link + wording for a planned trip: the query string carries the
 * endpoints, the fuel and vehicle assumptions and the strategy, and the
 * `/route/results` path says the link opens on the computed ribbon — so
 * following it recomputes and shows the very same trip. `ctx` names the
 * endpoints as displayed (« My position » included), for the wording only.
 */
export function routeShareData(
  view: RouteUrlView,
  origin: string,
  ctx: { from: string; to: string },
): ShareData {
  const url = `${base(origin)}/route/results${routeUrlQuery(view)}`;
  return { title: m.share_route_title(ctx), text: m.share_route(ctx), url };
}
