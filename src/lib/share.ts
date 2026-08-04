// Sharing — the payloads handed to the Web Share API (or, when it is missing,
// to the clipboard): a station fiche, the map view itself, and a planned trip.
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
  const where = station.city ? ` (${station.city})` : '';
  const text = price
    ? `${station.name}${where} — ${price.fuelLabel} à ${fmtPrice(price.value)} €/L sur Plein.`
    : `${station.name}${where} sur Plein.`;
  return { title: `Plein. — ${station.name}`, text, url };
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
  const where = ctx.place ? `autour de ${ctx.place}` : 'dans cette zone';
  return {
    title: `Plein. — ${ctx.fuelLabel} ${where}`,
    text: `Les prix du ${ctx.fuelLabel} ${where} sur Plein.`,
    url,
  };
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
  return {
    title: `Plein. — ${ctx.from} → ${ctx.to}`,
    text: `Le trajet ${ctx.from} → ${ctx.to}, avec où faire le plein au meilleur prix, sur Plein.`,
    url,
  };
}
