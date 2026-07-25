// Opening hours — shared model + "open now" computation.
// The gouv flux exposes `horaires` per station; many stations only flag
// 24/24 automats or list days without time ranges, so "unknown" is a
// first-class outcome: the UI must not claim « Ouvert » without evidence.

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
 */
export function openStatus(hours: StationHours | undefined, now = new Date()): OpenStatus | null {
  if (!hours) return null;
  if (hours.auto24) return { open: true, kind: 'open24h' };

  const today = hours.days[isoDay(now)];
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // A range from yesterday can spill past midnight (e.g. 22 h – 6 h)
  const yesterday = new Date(now.getTime() - DAY_MIN * 60_000);
  for (const r of normalized(hours.days[isoDay(yesterday)])) {
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
