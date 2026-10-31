const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const paths = require('./paths.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');
const { getManifest } = require('./launcher/versions.cjs');
const { LOADER_NAMES, loaderVersions } = require('./launcher/loaders.cjs');
const settings = require('./settings.cjs');
const { totalMemoryMb } = settings;

const file = () => path.join(paths.root(), 'profiles.json');
const withLock = createLock();

// Fills fields added after a profile was first saved.
function normalize(p) {
  return {
    loader: 'vanilla',
    loaderVersion: null,
    icon: null,
    cover: null,
    pack: null,
    playtimeMs: 0,
    // A folder on the profiles page, and whether it's in the sidebar.
    group: null,
    pinned: false,
    ...p,
    settings: {
      memoryMb: null,
      jvmArgs: '',
      resolution: null,
      fullscreen: null,
      preLaunchCommand: null,
      postExitCommand: null,
      ...p.settings,
    },
  };
}

const load = async () => (await readJson(file(), [])).map(normalize);

/** Checks a version/loader combination exists; returns the cleaned selection. */
async function validateVersion({ mcVersion, loader = 'vanilla', loaderVersion = null }) {
  if (!(loader in LOADER_NAMES)) throw new Error(`Unsupported loader "${loader}".`);
  const manifest = await getManifest();
  if (!manifest.versions.some((v) => v.id === mcVersion)) throw new Error(`Unknown Minecraft version ${mcVersion}.`);
  if (loader === 'vanilla') return { mcVersion, loader, loaderVersion: null };
  const available = await loaderVersions(loader, mcVersion);
  if (!available.some((v) => v.version === loaderVersion)) {
    throw new Error(`${LOADER_NAMES[loader]} ${loaderVersion} isn't available for Minecraft ${mcVersion}.`);
  }
  return { mcVersion, loader, loaderVersion };
}

function gameDir(id) {
  return path.join(paths.profilesDir(), id);
}

async function get(id) {
  const profile = (await load()).find((p) => p.id === id);
  if (!profile) throw new Error('Profile not found.');
  return profile;
}

/**
 * New profiles start with the game settings (keybinds, video, sound) of the most recently
 * played profile that has any. Packs that ship their own options.txt overwrite it afterwards.
 */
async function copySharedOptions(existing, id) {
  if (!(await settings.get()).shareOptions) return;
  const played = existing.filter((p) => p.lastPlayedAt).sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
  for (const p of played) {
    const source = path.join(gameDir(p.id), 'options.txt');
    const found = await fsp.access(source).then(() => true, () => false);
    if (found) return fsp.copyFile(source, path.join(gameDir(id), 'options.txt'));
  }
}

async function create({ name, ...selection }) {
  const version = await validateVersion(selection);
  return withLock(async () => {
    const defaultName = `${version.loader === 'vanilla' ? 'Minecraft' : LOADER_NAMES[version.loader]} ${version.mcVersion}`;
    const profile = normalize({
      id: randomUUID(),
      name: String(name ?? '').trim().slice(0, 48) || defaultName,
      ...version,
      createdAt: new Date().toISOString(),
      lastPlayedAt: null,
    });
    await fsp.mkdir(gameDir(profile.id), { recursive: true });
    const all = await load();
    await copySharedOptions(all, profile.id).catch(() => {});
    all.push(profile);
    await writeJson(file(), all);
    return profile;
  });
}

// Per-launch output that a copy shouldn't inherit.
const SKIP_ON_DUPLICATE = new Set(['logs', 'crash-reports']);

/** Copies a profile: its whole folder (mods, worlds, config, icon) and settings. */
async function duplicate(id, name) {
  const source = await get(id);
  const copy = normalize({
    ...source,
    id: randomUUID(),
    name: String(name ?? '').trim().slice(0, 48) || `${source.name} (copy)`.slice(0, 48),
    createdAt: new Date().toISOString(),
    lastPlayedAt: null,
    playtimeMs: 0,
    pinned: false,
  });
  const from = gameDir(id);
  try {
    await fsp.mkdir(gameDir(copy.id), { recursive: true });
    // Entry by entry: Electron's fs.cp ignores the `filter` option.
    for (const entry of await fsp.readdir(from).catch(() => [])) {
      if (SKIP_ON_DUPLICATE.has(entry)) continue;
      await fsp.cp(path.join(from, entry), path.join(gameDir(copy.id), entry), { recursive: true });
    }
  } catch (err) {
    await fsp.rm(gameDir(copy.id), { recursive: true, force: true });
    throw err;
  }
  return withLock(async () => {
    const all = await load();
    all.push(copy);
    await writeJson(file(), all);
    return copy;
  });
}

function update(id, patch) {
  return withLock(async () => {
    const all = await load();
    const profile = all.find((p) => p.id === id);
    if (!profile) throw new Error('Profile not found.');
    Object.assign(profile, patch);
    await writeJson(file(), all);
    return profile;
  });
}

function addPlaytime(id, ms) {
  if (!(ms > 0)) return Promise.resolve();
  return withLock(async () => {
    const all = await load();
    const profile = all.find((p) => p.id === id);
    if (!profile) return;
    profile.playtimeMs += Math.round(ms);
    await writeJson(file(), all);
  });
}

function rename(id, name) {
  const clean = String(name ?? '').trim().slice(0, 48);
  if (!clean) throw new Error('Profile name can’t be empty.');
  return update(id, { name: clean });
}

async function setVersion(id, selection) {
  return update(id, await validateVersion(selection));
}

function cleanSettings(patch) {
  const clean = {};
  if ('memoryMb' in patch) {
    if (patch.memoryMb === null) {
      clean.memoryMb = null;
    } else {
      const mb = Math.round(Number(patch.memoryMb));
      if (!Number.isFinite(mb) || mb < 512 || mb > totalMemoryMb()) throw new Error('Invalid memory amount.');
      clean.memoryMb = mb;
    }
  }
  if ('jvmArgs' in patch) {
    clean.jvmArgs = String(patch.jvmArgs ?? '').trim().slice(0, 2000);
  }
  if ('resolution' in patch) {
    if (patch.resolution === null) {
      clean.resolution = null;
    } else {
      const width = Math.round(Number(patch.resolution?.width));
      const height = Math.round(Number(patch.resolution?.height));
      if (!(width >= 320 && width <= 7680 && height >= 240 && height <= 4320)) {
        throw new Error('Window size must be between 320×240 and 7680×4320.');
      }
      clean.resolution = { width, height };
    }
  }
  if ('fullscreen' in patch) {
    clean.fullscreen = patch.fullscreen === null ? null : Boolean(patch.fullscreen);
  }
  // null means "use the global command"; an empty string means "run nothing for this profile".
  for (const key of ['preLaunchCommand', 'postExitCommand']) {
    if (key in patch) clean[key] = patch[key] === null ? null : String(patch[key] ?? '').trim().slice(0, 2000);
  }
  return clean;
}

const cleanGroup = (group) => {
  const name = String(group ?? '').trim().slice(0, 40);
  return name || null;
};

/** Moves a profile into a group (null for none) and/or pins it to the sidebar. */
function organize(id, patch) {
  const clean = {};
  if ('group' in (patch ?? {})) clean.group = cleanGroup(patch.group);
  if ('pinned' in (patch ?? {})) clean.pinned = Boolean(patch.pinned);
  return update(id, clean);
}

/** Renames a group on every profile in it; a null name takes them out of the group. */
function renameGroup(from, to) {
  const name = cleanGroup(to);
  return withLock(async () => {
    const all = await load();
    for (const p of all) if (p.group === from) p.group = name;
    await writeJson(file(), all);
    return all;
  });
}

function updateSettings(id, patch) {
  const clean = cleanSettings(patch ?? {});
  return withLock(async () => {
    const all = await load();
    const profile = all.find((p) => p.id === id);
    if (!profile) throw new Error('Profile not found.');
    profile.settings = { ...profile.settings, ...clean };
    await writeJson(file(), all);
    return profile;
  });
}

const LOG_TAIL_BYTES = 512 * 1024;

// Older versions print "Session ID is token:<accessToken>:<uuid>"; access tokens are JWTs.
// Hide both so logs are safe to view and share.
function redactTokens(text) {
  return text
    .replace(/token:[^:\s\]]+:/g, 'token:<hidden>:')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<hidden token>');
}

/** The tail of the profile's last launch log, or null if it has never been launched. */
async function readLog(id) {
  await get(id);
  const file = path.join(gameDir(id), 'logs', 'workbench-launch.log');
  const handle = await fsp.open(file).catch(() => null);
  if (!handle) return null;
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, size - length);
    return redactTokens(buf.toString('utf8'));
  } finally {
    await handle.close();
  }
}

function remove(id) {
  return withLock(async () => {
    const all = await load();
    // Only ever delete folders of profiles we know about.
    if (!all.some((p) => p.id === id)) throw new Error('Profile not found.');
    await fsp.rm(gameDir(id), { recursive: true, force: true });
    await writeJson(file(), all.filter((p) => p.id !== id));
  });
}

module.exports = {
  list: load,
  get,
  create,
  duplicate,
  update,
  addPlaytime,
  rename,
  setVersion,
  updateSettings,
  organize,
  renameGroup,
  remove,
  readLog,
  gameDir,
};
