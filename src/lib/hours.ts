// Opening hours — shared model + "open now" computation.
// The gouv flux exposes `horaires` per station; many stations only flag
// 24/24 automats or list days without time ranges, so "unknown" is a
// first-class outcome: the UI must not claim « Open » without evidence.

import { stationCountry } from '../data/stationIds';

export interface HoursRange {
  /** Minutes from midnight, local time */
  open: number;
  close: number;
}

export interface DayHours {
  closed: boolean;
  ranges: HoursRange[];
}

export interface StationHours {
  /** 24/24 self-service pumps */
  auto24: boolean;
  /** ISO day (1 = Monday … 7 = Sunday); missing entry = unknown */
  days: Partial<Record<number, DayHours>>;
}

/**
 * What the source says about right now, as data — the copy is assembled by
 * the view (lib/labels.ts) so this stays a pure, locale-free computation.
 */
export type OpenStatusKind =
  | 'open24h'
  /** Open, and `atMinutes` is when it closes */
  | 'openUntil'
  | 'closedToday'
  /** Closed, and `atMinutes` is when it opens again today */
  | 'opensAt'
  | 'closed';

export interface OpenStatus {
  open: boolean;
  kind: OpenStatusKind;
  /** Boundary time in minutes from midnight — only for `openUntil` / `opensAt` */
  atMinutes?: number;
}

const DAY_MIN = 24 * 60;

/** ISO day (1 = Monday … 7 = Sunday) for a JS Date */
function isoDay(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

/** ISO day before `day` — weekday arithmetic, so a 23 h or 25 h DST day cannot skip or repeat one */
function previousIsoDay(day: number): number {
  return ((day + 5) % 7) + 1;
}

// ── Station wall clock ───────────────────────────────────────────────────────
// Published hours are the station's own wall clock. Reading « now » off the
// device instead is an hour off for anyone looking across a zone border
// (Portugal ↔ Spain, the peninsula ↔ the Canaries) and many hours off for the
// French overseas departments.

/**
 * IANA zone a station's opening hours are written in, or undefined for ids
 * outside the country scheme (the demo dataset), which follow the device.
 * The sources carry no zone, so the offshore territories are told apart by
 * where the station is.
 */
export function stationTimeZone(station: {
  id: string;
  lat: number;
  lng: number;
}): string | undefined {
  const { lat, lng } = station;
  switch (stationCountry(station.id)) {
    case 'fr':
      // Every territory the gouv flux serves (FRA_COVERAGE in AutoProviders)
      if (lng < -40) return lat < 10 ? 'America/Cayenne' : 'America/Guadeloupe'; // Guyane · Antilles
      if (lat < 0) return lng > 50 ? 'Indian/Reunion' : 'Indian/Mayotte';
      return 'Europe/Paris';
    case 'es':
      // The Canaries end at 13.3° W, Galicia at 9.3° W; Ceuta and Melilla keep the peninsular clock
      return lng < -12 ? 'Atlantic/Canary' : 'Europe/Madrid';
    case 'ad':
      return 'Europe/Andorra';
    case 'pt':
      // Madeira keeps the mainland clock, the Azores run an hour behind
      return lng < -20 ? 'Atlantic/Azores' : 'Europe/Lisbon';
    default:
      return undefined;
  }
}

const ISO_DAY_BY_NAME: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const WALL_CLOCK_FORMATS = new Map<string, Intl.DateTimeFormat | null>();

/** Formatter for `timeZone`, or null when the runtime does not know the zone */
function wallClockFormat(timeZone: string): Intl.DateTimeFormat | null {
  let format = WALL_CLOCK_FORMATS.get(timeZone);
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      format = null;
    }
    WALL_CLOCK_FORMATS.set(timeZone, format);
  }
  return format;
}

/** ISO weekday and minutes from midnight of instant `now`, read in `timeZone` (the device zone when undefined) */
function wallClock(now: Date, timeZone: string | undefined): { day: number; minutes: number } {
  const format = timeZone ? wallClockFormat(timeZone) : null;
  if (format) {
    const f: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
    for (const { type, value } of format.formatToParts(now)) f[type] = value;
    const day = ISO_DAY_BY_NAME[f.weekday ?? ''];
    const minutes = Number(f.hour) * 60 + Number(f.minute);
    if (day && Number.isFinite(minutes)) return { day, minutes };
  }
  return { day: isoDay(now), minutes: now.getHours() * 60 + now.getMinutes() };
}

/** Ranges of a day, with overnight ranges (close ≤ open) extended past midnight */
function normalized(day: DayHours | undefined): HoursRange[] {
  if (!day || day.closed) return [];
  return day.ranges.map((r) =>
    r.close <= r.open ? { open: r.open, close: r.close + DAY_MIN } : r,
  );
}

/**
 * Open/closed right now, or null when the source doesn't say.
 * A day listed as open but without time ranges counts as unknown.
 * `timeZone` is the zone the hours are written in (`stationTimeZone`); without
 * one, `now` is read on the device clock.
 */
export function openStatus(
  hours: StationHours | undefined,
  now = new Date(),
  timeZone?: string,
): OpenStatus | null {
  if (!hours) return null;
  if (hours.auto24) return { open: true, kind: 'open24h' };

  const { day, minutes: nowMin } = wallClock(now, timeZone);
  const today = hours.days[day];

  // A range from yesterday can spill past midnight (e.g. 22 h – 6 h)
  for (const r of normalized(hours.days[previousIsoDay(day)])) {
    if (r.close > DAY_MIN && nowMin < r.close - DAY_MIN) {
      return { open: true, kind: 'openUntil', atMinutes: r.close };
    }
  }

  if (!today) return null;
  if (today.closed) return { open: false, kind: 'closedToday' };

  const ranges = normalized(today);
  if (!ranges.length) return null; // « open » day without hours → unknown

  for (const r of ranges) {
    if (nowMin >= r.open && nowMin < r.close) {
      return { open: true, kind: 'openUntil', atMinutes: r.close };
    }
  }
  const next = ranges.filter((r) => r.open > nowMin).sort((a, b) => a.open - b.open)[0];
  if (next) return { open: false, kind: 'opensAt', atMinutes: next.open };
  return { open: false, kind: 'closed' };
}

/** `openStatus` of a station, on the wall clock its hours are written in */
export function stationOpenStatus(
  station: { id: string; lat: number; lng: number; hours?: StationHours },
  now = new Date(),
): OpenStatus | null {
  return openStatus(station.hours, now, stationTimeZone(station));
}
