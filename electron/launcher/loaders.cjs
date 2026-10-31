const path = require('node:path');
const paths = require('../paths.cjs');
const { readJson, writeJson } = require('../store.cjs');
const { cachedJson, fetchJson } = require('./http.cjs');
const forge = require('./forge.cjs');

// Fabric and Quilt publish launcher profiles that "inherit" from the vanilla version JSON.
// Forge and NeoForge need their installer run first (see forge.cjs).
const META = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3',
};

const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

const isForgeLike = (loader) => loader === 'forge' || loader === 'neoforge';

function metaUrl(loader) {
  const url = META[loader];
  if (!url) throw new Error(`Unsupported loader "${loader}".`);
  return url;
}

/** Minecraft versions the loader supports. */
async function supportedGameVersions(loader) {
  if (isForgeLike(loader)) return forge.supportedGameVersions(loader);
  const list = await cachedJson(`${metaUrl(loader)}/versions/game`);
  return list.map((v) => v.version);
}

/** Loader versions for a Minecraft version, newest first. */
async function loaderVersions(loader, mcVersion) {
  if (isForgeLike(loader)) return forge.loaderVersions(loader, mcVersion);
  const list = await cachedJson(`${metaUrl(loader)}/versions/loader/${encodeURIComponent(mcVersion)}`);
  // Quilt has no stable flag; its pre-releases are tagged in the version string.
  return list.map(({ loader: l }) => ({ version: l.version, stable: l.stable ?? !/beta|pre|rc/i.test(l.version) }));
}

/** A loader+game profile never changes once published, so a saved copy is reused as-is. */
async function getLoaderProfile(loader, mcVersion, loaderVersion) {
  const file = path.join(paths.meta(), 'loaders', loader, `${mcVersion}-${loaderVersion}.json`);
  const saved = await readJson(file, null).catch(() => null);
  if (saved) return saved;
  const url = `${metaUrl(loader)}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const data = await fetchJson(url);
  await writeJson(file, data);
  return data;
}

// group:artifact[:classifier], ignoring version, so a loader's library replaces vanilla's copy.
function libraryKey(name) {
  const [group, artifact, , classifier] = name.split('@')[0].split(':');
  return classifier ? `${group}:${artifact}:${classifier}` : `${group}:${artifact}`;
}

/**
 * Applies a loader's version JSON on top of vanilla. With `ownJar`, the vanilla client
 * jar is launched under the loader's id (Forge's module system ignores it by that name).
 */
function mergeVersion(parent, child, { ownJar = false } = {}) {
  const childKeys = new Set(child.libraries.map((l) => libraryKey(l.name)));
  return {
    ...parent,
    id: child.id,
    clientFrom: parent.id,
    jar: ownJar ? child.id : (parent.jar ?? parent.id),
    mainClass: child.mainClass ?? parent.mainClass,
    libraries: [...child.libraries, ...parent.libraries.filter((l) => !childKeys.has(libraryKey(l.name)))],
    arguments: parent.arguments && {
      game: [...(parent.arguments.game ?? []), ...(child.arguments?.game ?? [])],
      jvm: [...(parent.arguments.jvm ?? []), ...(child.arguments?.jvm ?? [])],
    },
    // Legacy loader profiles replace the whole argument string.
    minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
  };
}

/**
 * The version JSON to launch for a profile. Forge/NeoForge may need to run their
 * installer first, which uses the game's Java runtime.
 */
async function resolveVersion({ loader, mcVersion, loaderVersion }, { vanilla, java, onProgress }) {
  if (loader === 'vanilla') return vanilla;
  if (isForgeLike(loader)) {
    const child = await forge.installForge({ loader, loaderVersion, vanilla, java, onProgress });
    return mergeVersion(vanilla, child, { ownJar: true });
  }
  return mergeVersion(vanilla, await getLoaderProfile(loader, mcVersion, loaderVersion));
}

module.exports = { LOADER_NAMES, supportedGameVersions, loaderVersions, resolveVersion };
