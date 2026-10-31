import type { Loader } from './types';

export const LOADER_LABELS: Record<Loader, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
};

export const LOADER_OPTIONS: { id: Loader | 'forge' | 'neoforge'; label: string; available: boolean }[] = [
  { id: 'vanilla', label: 'Vanilla', available: true },
  { id: 'fabric', label: 'Fabric', available: true },
  { id: 'quilt', label: 'Quilt', available: true },
  { id: 'forge', label: 'Forge', available: false },
  { id: 'neoforge', label: 'NeoForge', available: false },
];
