// What's new — the hand-written changelog announced to returning users.
//
// A deploy is not an announcement: most of them change nothing a user would
// notice, so nothing is derived from commits or versions. An entry exists
// because someone wrote one, in the same commit as the change it announces:
//
//   1. add its copy to `messages/fr.json` (the source) and translate it in
//      the four other catalogs — `changelog_<id>_title` plus one
//      `changelog_<id>_item_<what>` per bullet, each a whole sentence;
//   2. put the entry at the TOP of `CHANGELOG` below.
//
// The next time a returning user opens a build carrying it — the reload the
// update bar offers, or any later cold start — a small sparkle wiggles in a
// corner of the map (`WhatsNewButton`). Nothing more: the app is used behind
// the wheel, so reading is opt-in. A tap opens the sheet that lists it
// (`WhatsNewSheet`); Settings › What's new reopens the whole log at any time.
import { m } from '../paraglide/messages.js';

export interface ChangelogEntry {
  /**
   * Publication date, `YYYY-MM-DD` — it is both the date shown and the
   * identity the « seen » mark compares against, so ids sort the way the log
   * reads. A second entry on the same day takes a suffix (`2026-11-07.2`),
   * which still sorts after the first.
   */
  id: string;
  title: () => string;
  items: readonly (() => string)[];
}

/** Newest first. Never edit an id once shipped: it is what users have seen.
    The August entries were written after the fact, from the merge history, so
    the log reads as a history from its first day rather than a lone item. */
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: '2026-11-10',
    title: m.changelog_2026_11_10_title,
    items: [
      m.changelog_2026_11_10_item_whatsnew,
      m.changelog_2026_11_10_item_accent,
      m.changelog_2026_11_10_item_departure,
      m.changelog_2026_11_10_item_hours,
      m.changelog_2026_11_10_item_rotate,
      m.changelog_2026_11_10_item_accessibility,
    ],
  },
  {
    id: '2026-08-28',
    title: m.changelog_2026_08_28_title,
    items: [
      m.changelog_2026_08_28_item_update,
      m.changelog_2026_08_28_item_tiles,
      m.changelog_2026_08_28_item_filters,
      m.changelog_2026_08_28_item_motion,
    ],
  },
  {
    id: '2026-08-05',
    title: m.changelog_2026_08_05_title,
    items: [
      m.changelog_2026_08_05_item_destination,
      m.changelog_2026_08_05_item_endpoints,
      m.changelog_2026_08_05_item_firefox,
    ],
  },
  {
    id: '2026-08-04',
    title: m.changelog_2026_08_04_title,
    items: [
      m.changelog_2026_08_04_item_force_offline,
      m.changelog_2026_08_04_item_zoom,
      m.changelog_2026_08_04_item_route_position,
      m.changelog_2026_08_04_item_locate,
      m.changelog_2026_08_04_item_light_theme,
    ],
  },
];

/** At most this many entries are announced at once — someone back after
    months gets the recent news, not a reading assignment */
export const MAX_ANNOUNCED = 3;

/** The id a « seen » mark stamps: the newest entry, or nothing to stamp */
export function latestChangelogId(entries: readonly { id: string }[]): string | undefined {
  return entries[0]?.id;
}

/**
 * Entries a returning user has not been shown yet, newest first.
 *
 * `seen` is the newest id they were shown. Absent means a blob written before
 * the log existed — someone who has used the app for a while — and they get
 * the latest entry only: the log's back catalogue is not news to them.
 * Newcomers never reach this with `seen` absent: onboarding stamps it, since
 * everything in the log is simply how the app is to them.
 */
export function unseenChangelog<T extends { id: string }>(
  entries: readonly T[],
  seen: string | undefined,
): T[] {
  if (seen === undefined) return entries.slice(0, 1);
  return entries.filter((e) => e.id > seen).slice(0, MAX_ANNOUNCED);
}

/** The calendar day an entry id names, at local midnight (never shifted by a
    UTC parse into the previous day) */
export function changelogDate(id: string): Date {
  const [y, mo, d] = id.slice(0, 10).split('-').map(Number);
  return new Date(y, mo - 1, d);
}

/**
 * How the log opens. From the map's sparkle it is `unread`: the news this
 * session announced leads, and the earlier entries wait behind « See earlier
 * changes » — someone who just came back wants what changed since, with the
 * history one tap away. From Settings it is `all`: the whole history, open.
 */
export type WhatsNewView = 'unread' | 'all';

/**
 * Splits the log for a view: `lead` is shown at once, `earlier` behind the
 * unroll. With nothing announced this session there is no news to lead with,
 * and an `unread` view shows the whole history like `all` rather than an
 * empty sheet.
 */
export function splitChangelog<T extends { id: string }>(
  entries: readonly T[],
  fresh: ReadonlySet<string>,
  view: WhatsNewView,
): { lead: T[]; earlier: T[] } {
  const lead = view === 'unread' ? entries.filter((e) => fresh.has(e.id)) : [];
  if (lead.length === 0) return { lead: [...entries], earlier: [] };
  return { lead, earlier: entries.filter((e) => !fresh.has(e.id)) };
}
