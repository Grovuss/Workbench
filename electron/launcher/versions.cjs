const path = require('node:path');
const paths = require('../paths.cjs');
const { readJson, writeJson } = require('../store.cjs');
const { fetchJson, download } = require('./http.cjs');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const CACHE_MS = 10 * 60_000;

let cached = null;
let cachedAt = 0;

/** Mojang's version list, falling back to the last saved copy when offline. */
async function getManifest() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const file = path.join(paths.meta(), 'version_manifest_v2.json');
  try {
    cached = await fetchJson(MANIFEST_URL);
    await writeJson(file, cached);
  } catch (err) {
    const saved = await readJson(file, null).catch(() => null);
    if (!saved) throw new Error(`Couldn't load the Minecraft version list: ${err.message}`);
    cached = saved;
  }
  cachedAt = Date.now();
  return cached;
}

async function getVersionJson(id) {
  const file = path.join(paths.versionsDir(), id, `${id}.json`);
  try {
    const entry = (await getManifest()).versions.find((v) => v.id === id);
    if (!entry) throw new Error(`Unknown Minecraft version ${id}.`);
    await download(entry.url, file, { sha1: entry.sha1, verify: true });
  } catch (err) {
    const local = await readJson(file, null).catch(() => null);
    if (local) return local;
    throw err;
  }
  return readJson(file);
}

module.exports = { getManifest, getVersionJson };
