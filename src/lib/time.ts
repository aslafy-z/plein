// Time-zone helpers for the open-data fluxes.
//
// Several sources stamp their timestamps as a bare wall clock in the
// publisher's own zone, with no offset ("19/07/2026 5:40:23"). Feeding such a
// string to `new Date()` resolves it against the *device's* zone, so the
// freshness labels drift by the difference for anyone outside that zone — and
// westward devices see stale prices as brand new. Parse the wall clock in the
// zone it was written in instead, and keep the resulting instant in UTC.

/** Offset of `timeZone` at instant `ms`, in minutes east of UTC (Madrid: 60 / 120) */
function zoneOffsetMinutes(timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ms);

  const f: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of parts) f[type] = value;

  // The same clock reading, re-encoded as if it were UTC: the gap to the
  // instant it describes IS the offset. `formatToParts` drops sub-second
  // digits, so compare against the whole second.
  const asUtc = Date.UTC(
    Number(f.year),
    Number(f.month) - 1,
    Number(f.day),
    Number(f.hour),
    Number(f.minute),
    Number(f.second),
  );
  return (asUtc - Math.floor(ms / 1000) * 1000) / 60_000;
}

/**
 * Wall-clock fields read in `timeZone` → epoch ms.
 *
 * The offset we need depends on the very instant we are looking for, so guess
 * it from the naive reading then re-resolve once against that guess — enough
 * to land on the right side of both DST switch-overs. `month` is 1-based.
 */
export function zonedTimeToMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = naive - zoneOffsetMinutes(timeZone, naive) * 60_000;
  return naive - zoneOffsetMinutes(timeZone, guess) * 60_000;
}
