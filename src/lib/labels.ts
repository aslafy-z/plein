// Id → display label. Everything the app stores, filters on or puts in a link
// is an English id; this is the single place those ids become words, and the
// words themselves live in the message catalog.
import { m } from '../paraglide/messages.js';
import type {
  DataSourceId,
  ExtraProductId,
  FuelId,
  GeocodeResult,
  ServiceTag,
  VehicleId,
} from '../data/types';
import { EXTRA_PRODUCT_IDS, SERVICE_TAGS } from '../data/types';
import { INDEPENDENT_BRAND_ID } from './brandIcons';
import type { Theme } from './colorScheme';
import { minutesLabel } from './format';
import type { OpenStatus } from './hours';

export function fuelLabel(id: FuelId): string {
  switch (id) {
    case 'diesel':
      return m.fuel_diesel();
    case 'e10':
      return m.fuel_e10();
    case 'unleaded98':
      return m.fuel_unleaded98();
    case 'unleaded95':
      return m.fuel_unleaded95();
    case 'e85':
      return m.fuel_e85();
    case 'lpg':
      return m.fuel_lpg();
  }
}

export function serviceTagLabel(id: ServiceTag): string {
  switch (id) {
    case 'open24h':
      return m.service_open24h();
    case 'carWash':
      return m.service_car_wash();
    case 'shop':
      return m.service_shop();
    case 'airPump':
      return m.service_air_pump();
    case 'additives':
      return m.service_additives();
    case 'adBlue':
      // A trademark, spelled the same in all five locales — the catalog
      // already carries it for the product chip, so there is one entry, not two
      return m.product_adblue();
  }
}

export function vehicleLabel(id: VehicleId): string {
  return id === 'motorcycle' ? m.vehicle_motorcycle() : m.vehicle_car();
}

export function themeLabel(theme: Theme): string {
  return theme === 'light' ? m.settings_theme_light() : m.settings_theme_dark();
}

/**
 * Brand groups are enseigne names — proper nouns no locale translates. Only
 * the catch-all group is a real id and needs the catalog.
 */
export function brandGroupLabel(group: string): string {
  return group === INDEPENDENT_BRAND_ID ? m.brand_independent() : group;
}

/**
 * Where a search result is, in one line. Most sources spell it out themselves
 * — « Gironde », « Girona » — and that proper noun passes straight through.
 * Andorra's returns the parish alone and Portugal's an OSM district, so the
 * app names the country, and it has to follow a language switch like any
 * other sentence.
 */
export function placeSublabel(place: GeocodeResult): string {
  switch (place.country) {
    case 'and':
      return place.sublabel ? m.place_andorra_parish({ parish: place.sublabel }) : m.place_andorra();
    case 'prt':
      return place.sublabel
        ? m.place_portugal_district({ district: place.sublabel })
        : m.place_portugal();
    default:
      return place.sublabel;
  }
}

function extraProductLabel(id: ExtraProductId): string {
  switch (id) {
    case 'dieselPremium':
      return m.product_diesel_premium();
    case 'petrolPremium':
      return m.product_petrol_premium();
    case 'agriculturalDiesel':
      return m.product_agricultural_diesel();
    case 'adBlue':
      return m.product_adblue();
    case 'cng':
      return m.product_cng();
    case 'lng':
      return m.product_lng();
    case 'bioCng':
      return m.product_bio_cng();
    case 'bioLng':
      return m.product_bio_lng();
    case 'hydrogen':
      return m.product_hydrogen();
    case 'renewableDiesel':
      return m.product_renewable_diesel();
    case 'renewablePetrol':
      return m.product_renewable_petrol();
    case 'biodiesel':
      return m.product_biodiesel();
    case 'bioethanol':
      return m.product_bioethanol();
    case 'heatingOilDelivered':
      return m.product_heating_oil_delivered();
    case 'heatingOilOnSite':
      return m.product_heating_oil_on_site();
  }
}

/**
 * A `Station.services` entry: a known service or product id becomes catalog
 * copy, and free text from the gouv flux (« Vente d'additifs carburants »)
 * passes straight through — nobody can translate what the source invents.
 */
export function serviceLabel(raw: string): string {
  if (EXTRA_PRODUCT_IDS.includes(raw as ExtraProductId)) {
    return extraProductLabel(raw as ExtraProductId);
  }
  if (SERVICE_TAGS.includes(raw as ServiceTag)) {
    // The chip has room for the full sentence here, unlike the filter pill
    return raw === 'open24h' ? m.service_open24h_filter() : serviceTagLabel(raw as ServiceTag);
  }
  return raw;
}

/** Chip label of a station's opening status, e.g. « Ouvert · ferme à 20 h 30 » */
export function openStatusLabel(status: OpenStatus): string {
  switch (status.kind) {
    case 'open24h':
      return m.hours_open_24h();
    case 'openUntil':
      return m.hours_open_until({ time: minutesLabel(status.atMinutes ?? 0) });
    case 'closedToday':
      return m.hours_closed_today();
    case 'opensAt':
      return m.hours_opens_at({ time: minutesLabel(status.atMinutes ?? 0) });
    case 'closed':
      return m.hours_closed();
  }
}

/** One-word status for the inline « 2,3 km · ouvert · MàJ … » summaries */
export function openStatusShort(status: OpenStatus): string {
  if (status.kind === 'open24h') return m.hours_short_open_24h();
  return status.open ? m.hours_short_open() : m.hours_short_closed();
}

/** Title of a data source in Réglages — domain names stay as they are */
export function sourceTitle(id: DataSourceId): string {
  switch (id) {
    case 'auto':
      return m.source_auto_title();
    case 'fra':
      return 'prix-carburants.gouv.fr';
    case 'esp':
      return 'geoportalgasolineras.es';
    case 'and':
      return 'sig.govern.ad';
    case 'prt':
      return 'precoscombustiveis.dgeg.gov.pt';
    case 'demo':
      return m.source_demo_title();
  }
}

export function sourceSublabel(id: DataSourceId): string {
  switch (id) {
    case 'auto':
      return m.source_auto_sub();
    case 'fra':
      return m.source_fra_sub();
    case 'esp':
      return m.source_esp_sub();
    case 'and':
      return m.source_and_sub();
    case 'prt':
      return m.source_prt_sub();
    case 'demo':
      return m.source_demo_sub();
  }
}
