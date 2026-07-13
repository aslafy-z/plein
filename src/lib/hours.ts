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
  /** ISO day (1 = lundi … 7 = dimanche); missing entry = unknown */
  days: Partial<Record<number, DayHours>>;
}

export interface OpenStatus {
  open: boolean;
  /** Chip label, e.g. "Ouvert · ferme à 20 h 30" */
  label: string;
  /** Inline label for one-line summaries, e.g. "ouvert" / "fermé" */
  short: string;
}

const DAY_MIN = 24 * 60;

function fmtMin(m: number): string {
  const mm = ((m % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h = Math.floor(mm / 60);
  const min = mm % 60;
  return min === 0 ? `${h} h` : `${h} h ${String(min).padStart(2, '0')}`;
}

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
  if (hours.auto24) return { open: true, label: 'Ouvert 24/24', short: 'ouvert 24/24' };

  const today = hours.days[isoDay(now)];
  const m = now.getHours() * 60 + now.getMinutes();

  // A range from yesterday can spill past midnight (e.g. 22 h – 6 h)
  const yesterday = new Date(now.getTime() - DAY_MIN * 60_000);
  for (const r of normalized(hours.days[isoDay(yesterday)])) {
    if (r.close > DAY_MIN && m < r.close - DAY_MIN) {
      return { open: true, label: `Ouvert · ferme à ${fmtMin(r.close)}`, short: 'ouvert' };
    }
  }

  if (!today) return null;
  if (today.closed) return { open: false, label: "Fermé aujourd'hui", short: 'fermé' };

  const ranges = normalized(today);
  if (!ranges.length) return null; // « open » day without hours → unknown

  for (const r of ranges) {
    if (m >= r.open && m < r.close) {
      return { open: true, label: `Ouvert · ferme à ${fmtMin(r.close)}`, short: 'ouvert' };
    }
  }
  const next = ranges.filter((r) => r.open > m).sort((a, b) => a.open - b.open)[0];
  if (next) {
    return { open: false, label: `Fermé · ouvre à ${fmtMin(next.open)}`, short: 'fermé' };
  }
  return { open: false, label: 'Fermé', short: 'fermé' };
}
