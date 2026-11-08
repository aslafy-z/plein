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
// update bar offers, or any later cold start — the What's new bar names it
// (`WhatsNewPrompt`), and the sheet behind it lists it (`WhatsNewSheet`).
// Settings › What's new reopens the whole log at any time.
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

/** Newest first. Never edit an id once shipped: it is what users have seen. */
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: '2026-11-07',
    title: m.changelog_2026_11_07_title,
    items: [
      m.changelog_2026_11_07_item_whatsnew,
      m.changelog_2026_11_07_item_destination,
      m.changelog_2026_11_07_item_endpoints,
      m.changelog_2026_11_07_item_offline,
      m.changelog_2026_11_07_item_update,
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
