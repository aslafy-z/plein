// Types for scripts/whats-new-release.mjs, which src/lib/changelog.test.ts imports
export function releaseTag(id: string): string;
export function messageKeyPrefix(id: string): string;
export function changelogIds(source: string): string[];
export function releaseNotes(id: string, catalog: Record<string, unknown>): string;
