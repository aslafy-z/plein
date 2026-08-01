// User-timing marks for the staged route pipeline.
//
// The point of staging is that the itinerary lands well before the stations do,
// and that difference is invisible from the outside otherwise. These marks make
// it readable in DevTools (Performance → User Timing) and assertable from an
// e2e test via performance.getEntriesByType('measure').
//
// Dev-only: there is no telemetry sink in this app, so nothing consumes them in
// production and the entries would only sit in the buffer.
import { IS_DEV } from './env';

const MARKS = [
  'route:submit',
  'route:geocoded',
  'route:geometry',
  'route:stations',
  'route:plan',
] as const;

export type RouteMark = (typeof MARKS)[number];

const MEASURES = [
  'route:time-to-geometry',
  'route:time-to-stations',
  'route:time-to-plan',
] as const;

/** Start a timing cycle. Marks left by the previous one would skew the measures. */
export function beginRouteTiming(): void {
  if (!IS_DEV) return;
  for (const name of MARKS) performance.clearMarks(name);
  for (const name of MEASURES) performance.clearMeasures(name);
  performance.mark('route:submit');
}

export function markRoute(name: RouteMark): void {
  if (!IS_DEV) return;
  // First landing wins: the plan stage settles again whenever its inputs move
  // (a strategy chip, a pinned stop), and re-marking would shift the measure
  // away from the initial load it describes.
  if (performance.getEntriesByName(name, 'mark').length > 0) return;
  performance.mark(name);
  if (name === 'route:geometry') measureFromSubmit('route:time-to-geometry', name);
  if (name === 'route:stations') measureFromSubmit('route:time-to-stations', name);
  if (name === 'route:plan') measureFromSubmit('route:time-to-plan', name);
}

function measureFromSubmit(name: string, end: RouteMark): void {
  try {
    performance.measure(name, 'route:submit', end);
  } catch {
    /* no start mark — the cycle was never opened; the mark alone is enough */
  }
}
