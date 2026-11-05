const fsp = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');
const paths = require('./paths.cjs');
const { getManifest } = require('./launcher/versions.cjs');
const { loaderVersions } = require('./launcher/loaders.cjs');
const { USER_AGENT } = require('./config.cjs');

// Rebuilds the profile list from the profile folders, for when profiles.json and its backup are
// both damaged. Each folder normally holds a copy of its own entry (SNAPSHOT). Older folders don't,
// so their version is worked out from the game's logs, then from the mods inside.

const SNAPSHOT = 'workbench-profile.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readText = (file) => fsp.readFile(file, 'utf8').catch(() => '');

/** What the game printed on its last start: "Loading Minecraft 1.21.1 with Fabric Loader 0.16.5", or Forge's launch arguments. */
async function fromLogs(dir) {
  const text = (await readText(path.join(dir, 'logs', 'workbench-launch.log'))) + (await readText(path.join(dir, 'logs', 'latest.log')));
  const fabricLike = /Loading Minecraft (\S+) with (Fabric|Quilt) Loader (\S+)/.exec(text);
  if (fabricLike) return { mcVersion: fabricLike[1], loader: fabricLike[2].toLowerCase(), loaderVersion: fabricLike[3] };
  const mc = /--fml\.mcVersion,? ([\w.-]+)/.exec(text)?.[1];
  const neo = /--fml\.neoForgeVersion,? ([\w.-]+)/.exec(text)?.[1];
  const forge = /--fml\.forgeVersion,? ([\w.-]+)/.exec(text)?.[1];
  if (mc && neo) return { mcVersion: mc, loader: 'neoforge', loaderVersion: neo };
  if (mc && forge) return { mcVersion: mc, loader: 'forge', loaderVersion: forge };
  return null;
}

/** The loader most of the mod jars are built for. */
async function loaderFromMods(dir) {
  const names = (await fsp.readdir(path.join(dir, 'mods')).catch(() => [])).filter((n) => /\.jar$/i.test(n));
  const votes = {};
  for (const name of names.slice(0, 60)) {
    try {
      const zip = new AdmZip(path.join(dir, 'mods', name));
      const loader = zip.getEntry('quilt.mod.json')
        ? 'quilt'
        : zip.getEntry('fabric.mod.json')
          ? 'fabric'
          : zip.getEntry('META-INF/neoforge.mods.toml')
            ? 'neoforge'
            : zip.getEntry('META-INF/mods.toml')
              ? 'forge'
              : null;
      if (loader) votes[loader] = (votes[loader] ?? 0) + 1;
    } catch {
      // Not a readable jar.
    }
  }
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The Minecraft version and loader most Modrinth-installed mods in the folder were picked for. */
async function fromModrinth(dir) {
  const meta = JSON.parse((await readText(path.join(dir, 'workbench-mods.json'))) || '{}').files ?? {};
  // Only mods that are turned on: ones left behind by a version change still point at the old version.
  const enabled = new Set(await fsp.readdir(path.join(dir, 'mods')).catch(() => []));
  const ids = [
    ...new Set(
      Object.entries(meta)
        .filter(([name, m]) => m.versionId && enabled.has(name))
        .map(([, m]) => m.versionId),
    ),
  ].slice(0, 100);
  if (!ids.length) return null;
  const res = await fetch(`https://api.modrinth.com/v2/versions?ids=${encodeURIComponent(JSON.stringify(ids))}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) return null;
  const versions = await res.json();
  const tally = (pick) => {
    const counts = new Map();
    for (const v of versions) for (const x of pick(v)) counts.set(x, (counts.get(x) ?? 0) + 1);
    return counts;
  };
  const games = tally((v) => v.game_versions);
  const loaders = tally((v) => v.loaders.filter((l) => ['fabric', 'quilt', 'forge', 'neoforge'].includes(l)));
  const releases = (await getManifest()).versions.filter((v) => v.type === 'release').map((v) => v.id);
  const top = (counts) => Math.max(0, ...counts.values());
  const mcVersion = releases.find((r) => games.get(r) === top(games)) ?? null;
  const loader = [...loaders].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { mcVersion, loader, tied: [...loaders.values()].filter((n) => n === top(loaders)).length > 1 };
}

/** A loader version that exists: the one found if it's listed, otherwise the newest stable one. */
async function realLoaderVersion(loader, mcVersion, found) {
  const list = await loaderVersions(loader, mcVersion).catch(() => []);
  const match = found && list.find((v) => v.version === found || v.version.endsWith(`-${found}`));
  return (match ?? list.find((v) => v.stable) ?? list[0])?.version ?? null;
}

async function guess(dir) {
  let found = await fromLogs(dir).catch(() => null);
  if (!found) {
    const fromJars = await loaderFromMods(dir);
    const modrinth = fromJars ? await fromModrinth(dir).catch(() => null) : null;
    // Modrinth knows which loader each version was made for; jars can be ambiguous (old NeoForge looks like Forge).
    const loader = modrinth?.loader && !modrinth.tied ? modrinth.loader : fromJars;
    found = { loader: loader ?? 'vanilla', mcVersion: modrinth?.mcVersion ?? null, loaderVersion: null };
  }
  if (!found.mcVersion) found.mcVersion = (await getManifest().catch(() => null))?.latest?.release ?? '1.21.1';
  if (found.loader !== 'vanilla') {
    const loaderVersion = await realLoaderVersion(found.loader, found.mcVersion, found.loaderVersion);
    if (loaderVersion) return { ...found, loaderVersion };
    return { mcVersion: found.mcVersion, loader: 'vanilla', loaderVersion: null };
  }
  return { ...found, loaderVersion: null };
}

/** Profile entries for every folder in profiles/, from their snapshots or a best guess. */
async function rebuild() {
  const root = paths.profilesDir();
  const folders = (await fsp.readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && UUID.test(e.name));
  const list = [];
  for (const { name: id } of folders) {
    const dir = path.join(root, id);
    try {
      const saved = JSON.parse(await fsp.readFile(path.join(dir, SNAPSHOT), 'utf8'));
      if (saved?.id === id && saved.mcVersion) {
        list.push(saved);
        continue;
      }
    } catch {
      // No snapshot: guess below.
    }
    const stat = await fsp.stat(dir).catch(() => null);
    list.push({
      id,
      name: null,
      ...(await guess(dir)),
      createdAt: (stat?.birthtime ?? new Date()).toISOString(),
      lastPlayedAt: null,
    });
  }
  list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let n = 0;
  for (const p of list) p.name ??= `Recovered profile ${++n}`;
  if (list.length) console.warn(`[profiles] Rebuilt the profile list from ${list.length} folder(s).`);
  return list;
}

module.exports = { SNAPSHOT, rebuild };
