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

function remove(id) {
  return withLock(async () => {
    const all = await load();
    // Only ever delete folders of profiles we know about.
    if (!all.some((p) => p.id === id)) throw new Error('Profile not found.');
    await fsp.rm(gameDir(id), { recursive: true, force: true });
    await writeJson(file(), all.filter((p) => p.id !== id));
  });
}

module.exports = { list: load, get, create, update, remove, gameDir };
