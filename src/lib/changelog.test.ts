import { describe, expect, it } from 'vitest';
import {
  CHANGELOG,
  MAX_ANNOUNCED,
  changelogDate,
  latestChangelogId,
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
});
