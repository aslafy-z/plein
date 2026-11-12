// The bridge between the What's new log (src/lib/changelog.ts) and a
// production promotion (.github/workflows/deploy.yml, `deploy-production`).
//
// A promotion either announces something or it does not. The newest
// CHANGELOG entry at the promoted commit tells which: an entry without its
// `release-<id>` tag yet has never reached production, so this promotion is
// the one that ships it — the job publishes a GitHub Release under that tag,
// whose page the entry links from the app (its ↗ button). An entry
// that is already tagged means there is no news, and the job asks for that
// to be said on purpose (the `silent` input): a performance pass or a fix
// users would not notice ships without a sparkle, a forgotten entry does not.
//
// Plain Node with no dependency, so the job can run it before `npm ci`.
// It reads the TypeScript source as text; `changelog.test.ts` checks that
// what it reads is what the app compiles.
//
//   node scripts/whats-new-release.mjs latest        newest entry id
//   node scripts/whats-new-release.mjs notes <id>    the entry, as Markdown (en)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Tag (and GitHub Release) of the promotion that shipped an entry */
export function releaseTag(id) {
  return `release-${id}`;
}

/** The catalog keys of an entry start with this: `2026-11-07.2` → `changelog_2026_11_07_2_` */
export function messageKeyPrefix(id) {
  return `changelog_${id.replace(/[^0-9A-Za-z]/g, '_')}_`;
}

/** Entry ids in `CHANGELOG` order (newest first), read off the source text */
export function changelogIds(source) {
  const start = source.indexOf('export const CHANGELOG');
  if (start < 0) throw new Error('CHANGELOG not found in changelog.ts');
  return [...source.slice(start).matchAll(/^\s*id: '([^']+)'/gm)].map((match) => match[1]);
}

/**
 * The entry as Markdown, from a catalog: its title as a heading, its items as
 * bullets, in catalog order — the top of the GitHub Release body, above the
 * generated list of merged pull requests.
 */
export function releaseNotes(id, catalog) {
  const prefix = messageKeyPrefix(id);
  const title = catalog[`${prefix}title`];
  if (typeof title !== 'string') throw new Error(`No ${prefix}title in the catalog`);
  const items = Object.entries(catalog)
    .filter(([key]) => key.startsWith(`${prefix}item_`))
    .map(([, text]) => `- ${text}`);
  return [`## ${title}`, '', ...items, ''].join('\n');
}

function main([command, arg]) {
  const root = new URL('../', import.meta.url);
  const read = (path) => readFileSync(new URL(path, root), 'utf8');
  if (command === 'latest') {
    const [latest] = changelogIds(read('src/lib/changelog.ts'));
    if (!latest) throw new Error('CHANGELOG is empty');
    return latest;
  }
  if (command === 'notes' && arg) {
    return releaseNotes(arg, JSON.parse(read('messages/en.json')));
  }
  throw new Error('usage: whats-new-release.mjs latest | notes <id>');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${main(process.argv.slice(2))}\n`);
}
