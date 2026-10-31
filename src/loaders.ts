import type { Loader, LoaderVersion } from './types';

export const LOADER_LABELS: Record<Loader, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};

export const LOADER_OPTIONS: Loader[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];

/** Forge versions are stored as "1.20.1-47.3.0"; show just "47.3.0". */
export function loaderVersionLabel(loader: Loader, mcVersion: string, version: string): string {
  return loader === 'forge' && version.startsWith(`${mcVersion}-`) ? version.slice(mcVersion.length + 1) : version;
}

export function defaultLoaderVersion(list: LoaderVersion[]): string | null {
  return (list.find((v) => v.recommended) ?? list.find((v) => v.stable) ?? list[0])?.version ?? null;
}
