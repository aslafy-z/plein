// Where a bug report goes, and what it arrives with.
//
// Two surfaces send reporters to GitHub — the Settings « Contact » row and
// the debug overlay's Report button — and they must land on the SAME place:
// the bug form in `.github/ISSUE_TEMPLATE/bug_report.yml`, which is what asks
// for the debug overlay snapshot. A bare `/issues/new` would skip the form
// (and the question) entirely.
//
// English-only by design: this is diagnostic data pasted into an issue, not
// UI copy (CLAUDE.md, Language).
import { APP_VERSION, REPO_URL } from './appUpdate';

/** The bug form's file name — GitHub keys `?template=` on it */
const BUG_TEMPLATE = 'bug_report.yml';
/** …and its `environment` field id, which is what `?environment=` prefills */
const ENV_FIELD = 'environment';

/**
 * The build and the browser, the two facts no snapshot of app state carries
 * on its own. One block, shared by the prefilled mail and the prefilled
 * issue so a report reads the same either way.
 */
export function environmentLines(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return [
    `version: ${APP_VERSION}`,
    `platform: ${nav.userAgentData?.platform || nav.platform || 'unknown'}`,
    `user agent: ${nav.userAgent}`,
  ].join('\n');
}

/** The bug form, prefilled with `env` — everything else the form asks itself */
export function bugReportUrl(env = environmentLines()): string {
  const params = new URLSearchParams({ template: BUG_TEMPLATE, [ENV_FIELD]: env });
  return `${REPO_URL}/issues/new?${params}`;
}
