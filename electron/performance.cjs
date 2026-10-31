const content = require('./content.cjs');
const profiles = require('./profiles.cjs');

// Well-known performance mods that are safe together. Renderers replace the same code, so only
// one is offered: Sodium where it exists, Embeddium (a Sodium port) on Forge and older NeoForge.
const MODS = [
  { id: 'AANobbMI', renderer: true, about: 'A faster renderer. Usually the biggest FPS boost.' },
  { id: 'sk9rgfiA', renderer: true, about: 'A faster renderer (Sodium for Forge). Usually the biggest FPS boost.' },
  { id: 'gvQqBUqZ', about: 'Speeds up game logic like mobs, redstone and chunk loading.' },
  { id: 'uXXizFIs', about: 'Cuts how much memory the game needs.' },
  { id: 'nmDcB62a', about: 'Faster startup and world loading, plus lots of small fixes.' },
  { id: '5ZwdcRci', about: 'Faster text, HUD and item rendering.' },
  { id: 'NNAgCjsB', about: 'Skips drawing mobs and block entities you can’t see.' },
  { id: '51shyZVL', about: 'Skips drawing more hidden block faces.' },
  { id: 'LQ3K71Q1', about: 'Lowers FPS while the game is in the background, to save power.' },
];

// Other renderers that can't run next to Sodium or Embeddium, spotted by file name.
const RENDERER_FILES = /optifine|optifabric|rubidium|embeddium|sodium(?!-extra)/i;

/**
 * Performance mods that can go on a profile:
 * [{ projectId, title, iconUrl, about, installed }]. Mods with no version for the profile are left out.
 */
async function suggestions(profileId) {
  const profile = await profiles.get(profileId);
  if (profile.loader === 'vanilla') throw new Error('Performance mods need a mod loader. Pick one in this profile’s settings.');
  const target = { profileId, kind: 'mod' };
  const installedMods = await content.list(target);
  const installedIds = new Set(installedMods.map((m) => m.projectId).filter(Boolean));

  const params = new URLSearchParams({ ids: JSON.stringify(MODS.map((m) => m.id)) });
  const [projects, available] = await Promise.all([
    content.modrinth(`/projects?${params}`),
    Promise.all(MODS.map((m) => content.versions(target, m.id).then((v) => v.length > 0, () => false))),
  ]);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const hasRenderer =
    MODS.some((m) => m.renderer && installedIds.has(m.id)) ||
    installedMods.some((m) => !MODS.some((p) => p.id === m.projectId) && RENDERER_FILES.test(m.fileName));
  let rendererOffered = false;

  const result = [];
  MODS.forEach((m, i) => {
    const installed = installedIds.has(m.id);
    if (!installed && !available[i]) return;
    if (m.renderer && !installed) {
      if (hasRenderer || rendererOffered) return;
      rendererOffered = true;
    }
    const project = byId.get(m.id);
    result.push({
      projectId: m.id,
      title: project?.title ?? m.id,
      iconUrl: project?.icon_url ?? null,
      about: m.about,
      installed,
    });
  });
  return result;
}

module.exports = { suggestions };
