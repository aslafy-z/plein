// What's new — the hand-written changelog announced to returning users.
//
// One entry per production release that has something to tell, and only
// those: a deploy is not an announcement. A performance pass, a refactor or
// a fix nobody would notice ships silently — no entry, no sparkle. An entry
// exists because someone wrote one, in the PR that makes the change (or a
// later one that groups a few, before the release):
//
//   1. add its copy to `messages/fr.json` (the source) and translate it in
//      the four other catalogs — `changelog_<id>_title` plus one
//      `changelog_<id>_item_<what>` per bullet, each a whole sentence;
//   2. put the entry at the TOP of `CHANGELOG` below.
//
// Short by rule: at most `MAX_ITEMS` bullets of one sentence each, the news
// rather than the inventory. The rest is one tap away: `details` links the
// GitHub Release of the promotion that ships the entry — the entry's English
// copy over every pull request merged since the previous one.
//
// Production promotion is where the two meet (`.github/workflows/deploy.yml`,
// `scripts/whats-new-release.mjs`): a newest entry not yet released makes the
// promotion publish the `release-<id>` tag and its Release; with no new entry
// the promotion refuses to run unless it is marked `silent` on purpose.
//
// The next time a returning user opens a build carrying a new entry — the
// reload the update bar offers, or any later cold start — a small sparkle
// wiggles in a corner of the map (`WhatsNewButton`). Nothing more: the app is
// used behind the wheel, so reading is opt-in. A tap opens the sheet that
// lists it (`WhatsNewSheet`); Settings › What's new reopens the whole log.
import { m } from '../paraglide/messages.js';
import type { Locale } from '../paraglide/runtime.js';

/** A catalog message: the current locale by default, another on request */
type Message = (inputs?: Record<string, never>, options?: { locale?: Locale }) => string;

export interface ChangelogEntry {
  /**
   * Publication date, `YYYY-MM-DD` — it is both the date shown and the
   * identity the « seen » mark compares against, so ids sort the way the log
   * reads. A second entry on the same day takes a suffix (`2026-11-07.2`),
   * which still sorts after the first.
   */
  id: string;
  title: Message;
  /** At most `MAX_ITEMS`, each one sentence */
  items: readonly Message[];
  /** Where the long version lives — `releaseNotesUrl(id)` for an entry
      shipped by a promotion. The backfilled entries predate releases and
      have none. */
  details?: string;
}

/** Bullets per entry: what is worth reading at the pump, not the inventory */
export const MAX_ITEMS = 4;

/** The GitHub Release the promotion shipping entry `id` publishes (tag
    `release-<id>`, see scripts/whats-new-release.mjs) */
export function releaseNotesUrl(id: string): string {
  return `${__REPO_URL__}/releases/tag/release-${id}`;
}

/** Newest first. Never edit an id once shipped: it is what users have seen,
    and its release tag is named after it.
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
      m.changelog_2026_11_10_item_accessibility,
    ],
    details: releaseNotesUrl('2026-11-10'),
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
