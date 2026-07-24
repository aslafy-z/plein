// Sharing a station fiche — the payload handed to the Web Share API (or, when
// it is missing, to the clipboard).
import { fmtPrice } from './format';

export type StationShareData = {
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

/**
 * Deep link + wording for a station. `origin` is `location.origin`; the path
 * is the same /station/:id the app already boots on, so a shared link opens
 * the fiche directly.
 */
export function stationShareData(
  station: ShareableStation,
  origin: string,
  price?: { fuelLabel: string; value: number } | null,
): StationShareData {
  const url = `${origin.replace(/\/+$/, '')}/station/${encodeURIComponent(station.id)}`;
  const where = station.city ? ` (${station.city})` : '';
  const text = price
    ? `${station.name}${where} — ${price.fuelLabel} à ${fmtPrice(price.value)} €/L sur Plein.`
    : `${station.name}${where} sur Plein.`;
  return { title: `Plein. — ${station.name}`, text, url };
}
