// Locale-aware formatting helpers.
//
// Numbers, wall-clock times and relative dates go through `Intl`, so the
// decimal separator, the clock convention and « il y a 2 h » follow the active
// locale instead of being hard-coded to French. Anything `Intl` has no
// primitive for (a duration written « 5 h 16 ») is a message in the catalog.
import { getLocale } from '../paraglide/runtime.js';
import { m } from '../paraglide/messages.js';

/** Placeholder for « we don't know » — same glyph in every locale */
export const EM_DASH = '—';

// Intl formatters are expensive to build and this module sits on the render
// path of every list row, so they are memoised per locale.
const numberFormats = new Map<string, Intl.NumberFormat>();

function decimals(digits: number): Intl.NumberFormat {
  const key = `${getLocale()}:${digits}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(key, f);
  }
  return f;
}

/** Fixed-precision decimal in the active locale: 6.5 -> "6,5" in French */
export function fmtDecimal(v: number, digits: number): string {
  return decimals(digits).format(v);
}

/** 1.679 -> "1,68" ; null/undefined -> "—" */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return EM_DASH;
  return decimals(2).format(v);
}

const sizeFormats = new Map<string, Intl.NumberFormat>();

/** Storage footprint: 220_000 -> "215 ko" in French, "215 kB" in English */
export function sizeLabel(bytes: number): string {
  // A few hundred bytes rounds to « 0 ko », which reads as a broken readout
  // rather than as « almost nothing ». The unit is part of the sentence, so
  // each locale writes its own — French counts in octets.
  if (bytes < 1024) return m.unit_size_under_kilobyte();
  const mega = bytes >= 1024 * 1024;
  const unit = mega ? 'megabyte' : 'kilobyte';
  const key = `${getLocale()}:${unit}`;
  let f = sizeFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(getLocale(), {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits: mega ? 1 : 0,
    });
    sizeFormats.set(key, f);
  }
  return f.format(mega ? bytes / (1024 * 1024) : Math.round(bytes / 1024));
}

/** 0.85 -> "850 m" ; 2.34 -> "2,3 km" */
export function distLabel(km: number): string {
  if (km < 1) return m.unit_metres({ metres: Math.round(km * 1000) });
  return m.unit_kilometres({ km: fmtDecimal(km, 1) });
}

/** 316 -> "5 h 16" ; 45 -> "45 min" */
export function durationLabel(min: number): string {
  const total = Math.round(min);
  if (total < 60) return m.unit_minutes({ minutes: total });
  return m.unit_hours_minutes({
    hours: Math.floor(total / 60),
    minutes: String(total % 60).padStart(2, '0'),
  });
}

/** Minutes from midnight as a wall-clock label — « 20 h 30 » is French for 20:30 */
export function minutesLabel(minutesFromMidnight: number): string {
  const day = 24 * 60;
  const mm = ((minutesFromMidnight % day) + day) % day;
  const hours = Math.floor(mm / 60);
  return mm % 60 === 0
    ? m.unit_hours({ hours })
    : m.unit_hours_minutes({ hours, minutes: String(mm % 60).padStart(2, '0') });
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock label for a Date, in the active locale's convention */
export function clockLabel(d: Date): string {
  let f = clockFormats.get(getLocale());
  if (!f) {
    f = new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' });
    clockFormats.set(getLocale(), f);
  }
  return f.format(d);
}

const dayMonthFormats = new Map<string, Intl.DateTimeFormat>();

/** Short calendar date for the trip history — « 25 juil. » in French */
export function dayMonthLabel(ms: number): string {
  let f = dayMonthFormats.get(getLocale());
  if (!f) {
    f = new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' });
    dayMonthFormats.set(getLocale(), f);
  }
  return f.format(new Date(ms));
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function relative(): Intl.RelativeTimeFormat {
  let f = relativeFormats.get(getLocale());
  if (!f) {
    // `auto` turns -1 day into « hier »; `short` keeps « il y a 2 h » compact
    // enough for a list row.
    f = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto', style: 'short' });
    relativeFormats.set(getLocale(), f);
  }
  return f;
}

/** Age of a past instant: "il y a 2 h" / "hier" / "il y a 3 j" */
export function agoLabelFrom(ms: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins <= 1) return m.time_just_now();
  if (mins < 60) return relative().format(-mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 24) return relative().format(-hours, 'hour');
  return relative().format(-Math.round(hours / 24), 'day');
}

/** ISO timestamp -> "il y a 2 h" / "hier" / "il y a 3 j" */
export function agoLabel(iso: string | undefined): string {
  if (!iso) return EM_DASH;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return EM_DASH;
  return agoLabelFrom(t);
}
