const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const paths = require('./paths.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');
const { getManifest } = require('./launcher/versions.cjs');

const file = () => path.join(paths.root(), 'profiles.json');
const withLock = createLock();

const load = () => readJson(file(), []);

function gameDir(id) {
  return path.join(paths.profilesDir(), id);
}

async function get(id) {
  const profile = (await load()).find((p) => p.id === id);
  if (!profile) throw new Error('Profile not found.');
  return profile;
}

function create({ name, mcVersion }) {
  return withLock(async () => {
    const manifest = await getManifest();
    if (!manifest.versions.some((v) => v.id === mcVersion)) {
      throw new Error(`Unknown Minecraft version ${mcVersion}.`);
    }
    const profile = {
      id: randomUUID(),
      name: String(name ?? '').trim().slice(0, 48) || `Minecraft ${mcVersion}`,
      loader: 'vanilla',
      mcVersion,
      createdAt: new Date().toISOString(),
      lastPlayedAt: null,
    };
    await fsp.mkdir(gameDir(profile.id), { recursive: true });
    const all = await load();
    all.push(profile);
    await writeJson(file(), all);
    return profile;
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

function rename(id, name) {
  const clean = String(name ?? '').trim().slice(0, 48);
  if (!clean) throw new Error('Profile name can’t be empty.');
  return update(id, { name: clean });
}

async function listWorlds(id) {
  await get(id);
  const savesDir = path.join(gameDir(id), 'saves');
  const entries = await fsp.readdir(savesDir, { withFileTypes: true }).catch(() => []);
  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(savesDir, entry.name);
    const stat = await fsp.stat(path.join(dir, 'level.dat')).catch(() => null);
    if (!stat) continue;
    const icon = await fsp.readFile(path.join(dir, 'icon.png')).catch(() => null);
    worlds.push({
      folder: entry.name,
      lastPlayedAt: stat.mtime.toISOString(),
      icon: icon ? `data:image/png;base64,${icon.toString('base64')}` : null,
    });
  }
  return worlds.sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
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

module.exports = { list: load, get, create, update, rename, remove, listWorlds, readLog, gameDir };
