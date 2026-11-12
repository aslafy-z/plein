import { describe, expect, it } from 'vitest';
import {
  changelogIds,
  messageKeyPrefix,
  releaseNotes,
  releaseTag,
} from '../../scripts/whats-new-release.mjs';
import { locales } from '../paraglide/runtime.js';
import EN_CATALOG from '../../messages/en.json?raw';
import SOURCE from './changelog.ts?raw';
import {
  CHANGELOG,
  MAX_ANNOUNCED,
  MAX_ITEMS,
  releaseNotesUrl,
  changelogDate,
  latestChangelogId,
  splitChangelog,
  unseenChangelog,
} from './changelog';

const log = (...ids: string[]) => ids.map((id) => ({ id }));

describe('unseenChangelog', () => {
  it('announces only the latest entry to a blob that predates the log', () => {
    expect(unseenChangelog(log('2026-12-01', '2026-11-07'), undefined)).toEqual(log('2026-12-01'));
  });

  it('announces every entry newer than the seen mark, newest first', () => {
    const entries = log('2027-01-10', '2026-12-01', '2026-11-07');
    expect(unseenChangelog(entries, '2026-11-07')).toEqual(log('2027-01-10', '2026-12-01'));
  });

  it('announces nothing once the newest entry was seen', () => {
    expect(unseenChangelog(log('2026-12-01', '2026-11-07'), '2026-12-01')).toEqual([]);
  });

  it('orders a same-day suffix after the plain date', () => {
    expect(unseenChangelog(log('2026-11-07.2', '2026-11-07'), '2026-11-07')).toEqual(
      log('2026-11-07.2'),
    );
  });

  it('still compares against a seen id the log no longer carries', () => {
    expect(unseenChangelog(log('2026-12-01', '2026-11-07'), '2026-11-20')).toEqual(
      log('2026-12-01'),
    );
  });

  it('caps a long absence to the most recent entries', () => {
    const entries = log('2027-05-01', '2027-04-01', '2027-03-01', '2027-02-01', '2027-01-01');
    expect(unseenChangelog(entries, '2026-01-01')).toHaveLength(MAX_ANNOUNCED);
    expect(unseenChangelog(entries, '2026-01-01')[0].id).toBe('2027-05-01');
  });

  it('has nothing to announce from an empty log', () => {
    expect(unseenChangelog([], undefined)).toEqual([]);
    expect(latestChangelogId([])).toBeUndefined();
  });
});

describe('changelogDate', () => {
  it('reads the id as a local calendar day', () => {
    const d = changelogDate('2026-11-07.2');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 7]);
  });
});

describe('CHANGELOG', () => {
  it('is sorted newest first with unique, dated ids', () => {
    const ids = CHANGELOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort().reverse()).toEqual(ids);
    for (const id of ids) {
      expect(id).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
      expect(Number.isNaN(changelogDate(id).getTime())).toBe(false);
    }
  });

  it('gives every entry a title and at least one item', () => {
    for (const e of CHANGELOG) {
      expect(e.title()).not.toBe('');
      expect(e.items.length).toBeGreaterThan(0);
      for (const item of e.items) expect(item()).not.toBe('');
    }
  });

  it('stamps the newest entry as seen', () => {
    expect(latestChangelogId(CHANGELOG)).toBe(CHANGELOG[0].id);
  });

  it('keeps every entry short in every locale', () => {
    for (const e of CHANGELOG) {
      expect(e.items.length, e.id).toBeLessThanOrEqual(MAX_ITEMS);
      for (const locale of locales) {
        expect(e.title({}, { locale }).length, `${e.id} title (${locale})`).toBeLessThanOrEqual(60);
        for (const item of e.items) {
          expect(item({}, { locale }).length, `${e.id} item (${locale})`).toBeLessThanOrEqual(140);
        }
      }
    }
  });

  it('links details only to an https page', () => {
    for (const e of CHANGELOG) if (e.details) expect(e.details).toMatch(/^https:\/\//);
  });
});

// The promotion job reads the log through scripts/whats-new-release.mjs,
// as text and before any build: what it reads has to be what the app ships.
describe('whats-new-release script', () => {
  const en = JSON.parse(EN_CATALOG) as Record<string, unknown>;

  it('reads the entry ids the app compiles, in order', () => {
    expect(changelogIds(SOURCE)).toEqual(CHANGELOG.map((e) => e.id));
  });

  it('writes each entry as the English copy the app shows', () => {
    for (const e of CHANGELOG) {
      const t = (msg: typeof e.title) => msg({}, { locale: 'en' });
      expect(releaseNotes(e.id, en)).toBe(
        [`## ${t(e.title)}`, '', ...e.items.map((item) => `- ${t(item)}`), ''].join('\n'),
      );
    }
  });

  it('names catalog keys and tags after the id', () => {
    expect(messageKeyPrefix('2026-11-07.2')).toBe('changelog_2026_11_07_2_');
    expect(releaseTag('2026-11-07.2')).toBe('release-2026-11-07.2');
    expect(releaseNotesUrl('2026-11-07.2')).toMatch(/\/releases\/tag\/release-2026-11-07\.2$/);
  });
});

describe('splitChangelog', () => {
  const entries = log('2027-01-10', '2026-12-01', '2026-11-07');

  it('leads the unread view with the news and keeps the history behind it', () => {
    expect(splitChangelog(entries, new Set(['2027-01-10', '2026-12-01']), 'unread')).toEqual({
      lead: log('2027-01-10', '2026-12-01'),
      earlier: log('2026-11-07'),
    });
  });

  it('opens the whole history for the all view, news included', () => {
    expect(splitChangelog(entries, new Set(['2027-01-10']), 'all')).toEqual({
      lead: entries,
      earlier: [],
    });
  });

  it('shows the whole history when nothing was announced this session', () => {
    expect(splitChangelog(entries, new Set(), 'unread')).toEqual({ lead: entries, earlier: [] });
  });

  it('has no earlier part when every entry is news', () => {
    expect(splitChangelog(entries, new Set(entries.map((e) => e.id)), 'unread').earlier).toEqual([]);
  });
});
