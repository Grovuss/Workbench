import type { ContentKind, Loader } from './types';

export const CONTENT: Record<ContentKind, { title: string; noun: string; nounPlural: string; ext: string }> = {
  mod: { title: 'Mods', noun: 'mod', nounPlural: 'mods', ext: '.jar' },
  resourcepack: { title: 'Resource packs', noun: 'resource pack', nounPlural: 'resource packs', ext: '.zip' },
  shader: { title: 'Shaders', noun: 'shader pack', nounPlural: 'shader packs', ext: '.zip' },
  datapack: { title: 'Data packs', noun: 'data pack', nounPlural: 'data packs', ext: '.zip' },
};

/** Why a profile can't use this kind of content, or null if it can. */
export function contentBlockedReason(kind: ContentKind, loader: Loader): string | null {
  if (loader !== 'vanilla') return null;
  if (kind === 'mod') return 'Switch this profile to Fabric, Quilt, Forge or NeoForge to add mods.';
  if (kind === 'shader') return 'Shaders need Iris, which runs on Fabric, Quilt or NeoForge. Switch this profile’s loader to add them.';
  return null;
}

/** Modrinth project id of Iris, the shader mod. */
export const IRIS_PROJECT_ID = 'YL57xq9U';
