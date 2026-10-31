const path = require('node:path');
const paths = require('../paths.cjs');
const { readJson, writeJson } = require('../store.cjs');
const { fetchJson } = require('./http.cjs');
const { getVersionJson } = require('./versions.cjs');

// Fabric and Quilt publish launcher profiles that "inherit" from the vanilla version JSON.
const META = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3',
};

const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt' };

const CACHE_MS = 10 * 60_000;
const cache = new Map();

async function cachedJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await fetchJson(url);
  cache.set(url, { at: Date.now(), data });
  return data;
}

function metaUrl(loader) {
  const url = META[loader];
  if (!url) throw new Error(`Unsupported loader "${loader}".`);
  return url;
}

/** Minecraft versions the loader supports. */
async function supportedGameVersions(loader) {
  const list = await cachedJson(`${metaUrl(loader)}/versions/game`);
  return list.map((v) => v.version);
}

/** Loader versions for a Minecraft version, newest first. */
async function loaderVersions(loader, mcVersion) {
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

function mergeVersion(parent, child) {
  const childKeys = new Set(child.libraries.map((l) => libraryKey(l.name)));
  return {
    ...parent,
    id: child.id,
    // The game jar (and natives) still belong to the vanilla version.
    jar: parent.jar ?? parent.id,
    mainClass: child.mainClass ?? parent.mainClass,
    libraries: [...child.libraries, ...parent.libraries.filter((l) => !childKeys.has(libraryKey(l.name)))],
    arguments: parent.arguments && {
      game: [...(parent.arguments.game ?? []), ...(child.arguments?.game ?? [])],
      jvm: [...(parent.arguments.jvm ?? []), ...(child.arguments?.jvm ?? [])],
    },
  };
}

/** The version JSON to launch for a profile: vanilla, or vanilla merged with its loader profile. */
async function resolveVersion({ mcVersion, loader, loaderVersion }) {
  const vanilla = await getVersionJson(mcVersion);
  if (loader === 'vanilla') return vanilla;
  return mergeVersion(vanilla, await getLoaderProfile(loader, mcVersion, loaderVersion));
}

module.exports = { LOADER_NAMES, supportedGameVersions, loaderVersions, resolveVersion };
