// IRVE `horaires` parser — the field uses OSM opening_hours syntax
// ("24/7", "Mo-Su 00:00-23:57", "Mo-Fr 08:00-19:00; Sa 09:00-12:00"…),
// unlike the gouv fuel flux's JSON format. Only the common patterns are
// covered; anything else stays undefined ("unknown" is a first-class outcome
// in lib/hours — the UI must not claim « Ouvert » without evidence).
import type { DayHours, StationHours } from '../../lib/hours';

const DAY_IDX: Record<string, number> = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 7 };

const DAY_MIN = 24 * 60;
/** A single range covering ≥ this much of the day counts as 24/24 (data often
 * says "00:00-23:57" or "00:00-23:59" to mean always open) */
const ALWAYS_OPEN_MIN = 23 * 60 + 50;

function clockMin(s: string): number | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** "Mo-Fr,Su" → [1,2,3,4,5,7]; null when a token isn't a day spec */
function parseDays(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const range = part.match(/^([a-z]{2})(?:-([a-z]{2}))?$/i);
    if (!range) return null;
    const from = DAY_IDX[range[1].toLowerCase()];
    const to = range[2] ? DAY_IDX[range[2].toLowerCase()] : from;
    if (!from || !to) return null;
    // Wrapping ranges (Sa-Mo) walk past Sunday
    for (let d = from; ; d = (d % 7) + 1) {
      out.add(d);
      if (d === to) break;
    }
  }
  return [...out];
}

export function parseOpeningHours(raw: unknown): StationHours | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (/^24\s*[/h]\s*7$/i.test(text) || /^24\s*[/h-]\s*24$/.test(text)) {
    return { auto24: true, days: {} };
  }

  const days: Partial<Record<number, DayHours>> = {};
  for (const ruleRaw of text.split(';')) {
    const rule = ruleRaw.trim();
    if (!rule) continue;
    // "Mo-Fr 08:00-12:00,14:00-19:00" | "08:00-20:00" (no day = every day)
    const m = rule.match(/^([a-z ,-]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*)$/i);
    if (m) {
      const daySpec = m[1].replace(/\s/g, '');
      const dayList = daySpec ? parseDays(daySpec) : [1, 2, 3, 4, 5, 6, 7];
      if (!dayList) return undefined;
      const ranges: DayHours['ranges'] = [];
      for (const span of m[2].split(',')) {
        const [o, c] = span.split('-').map((s) => clockMin(s.trim()));
        if (o == null || c == null || o === c) return undefined;
        ranges.push({ open: o, close: c === 0 ? DAY_MIN : c });
      }
      for (const d of dayList) days[d] = { closed: false, ranges };
      continue;
    }
    // "Sa off" / "Su closed"
    const off = rule.match(/^([a-z ,-]+?)\s+(?:off|closed)$/i);
    if (off) {
      const dayList = parseDays(off[1].replace(/\s/g, ''));
      if (!dayList) return undefined;
      for (const d of dayList) days[d] = { closed: true, ranges: [] };
      continue;
    }
    return undefined; // unsupported syntax — better unknown than wrong
  }

  if (Object.keys(days).length === 0) return undefined;

  // Every day one near-full range → present it as 24/24
  const allDays = Object.keys(days).length === 7;
  const alwaysOpen =
    allDays &&
    Object.values(days).every(
      (d) =>
        d != null &&
        !d.closed &&
        d.ranges.length === 1 &&
        d.ranges[0].open === 0 &&
        d.ranges[0].close >= ALWAYS_OPEN_MIN,
    );
  if (alwaysOpen) return { auto24: true, days: {} };

  return { auto24: false, days };
}
