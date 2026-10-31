import { useStoredChoice } from '../../stored';
import type { ContentVersion } from '../../types';

export const VERSION_SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'downloads', label: 'Most downloads' },
  { id: 'minecraft', label: 'Minecraft version' },
] as const;
export type VersionSort = (typeof VERSION_SORTS)[number]['id'];

/** The sort chosen for version lists, remembered across project pages and the version picker. */
export const useVersionSort = () =>
  useStoredChoice<VersionSort>('workbench.versionSort', VERSION_SORTS.map((s) => s.id), 'newest');

/** Compares "1.20.1"-style versions; snapshots and other names sort below releases. */
function compareGameVersions(a: string, b: string) {
  const pa = /^\d+(\.\d+)*$/.test(a) ? a.split('.').map(Number) : null;
  const pb = /^\d+(\.\d+)*$/.test(b) ? b.split('.').map(Number) : null;
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const newestGameVersion = (v: ContentVersion) => [...v.gameVersions].sort(compareGameVersions).pop() ?? '';
const byDate = (a: ContentVersion, b: ContentVersion) => Date.parse(b.date) - Date.parse(a.date);

export function sortVersions<T extends ContentVersion>(list: T[], sort: VersionSort): T[] {
  const sorted = [...list];
  if (sort === 'newest') sorted.sort(byDate);
  else if (sort === 'oldest') sorted.sort((a, b) => byDate(b, a));
  else if (sort === 'downloads') sorted.sort((a, b) => b.downloads - a.downloads);
  else sorted.sort((a, b) => compareGameVersions(newestGameVersion(b), newestGameVersion(a)) || byDate(a, b));
  return sorted;
}

/** "1.20.1 – 1.21.4" from Modrinth's list, releases only when there are any. */
export function versionRange(versions: string[]) {
  const releases = versions.filter((v) => /^\d+(\.\d+)+$/.test(v)).sort(compareGameVersions);
  const list = releases.length ? releases : versions;
  if (!list.length) return '';
  return list.length === 1 ? list[0] : `${list[0]} – ${list[list.length - 1]}`;
}
