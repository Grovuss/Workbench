const fsp = require('node:fs/promises');
const path = require('node:path');
const { shell } = require('electron');
const profiles = require('./profiles.cjs');

// Text config files in a profile: everything under config/, plus the game's own options.txt.

const CONFIG_DIR = 'config';
const ROOT_FILES = ['options.txt'];
const TEXT = /\.(json5?|jsonc|toml|properties|cfg|conf|txt|ya?ml|ini|snbt)$/i;
const MAX_DEPTH = 8;
const MAX_FILES = 5000;
const MAX_SIZE = 2 * 1024 * 1024;

/** [{ path, size, modifiedAt }] with paths like "config/sodium-options.json", sorted by path. */
async function list(profileId) {
  await profiles.get(profileId);
  const gameDir = profiles.gameDir(profileId);
  const files = [];

  const add = async (rel) => {
    const stat = await fsp.stat(path.join(gameDir, rel)).catch(() => null);
    if (stat?.isFile()) files.push({ path: rel.split(path.sep).join('/'), size: stat.size, modifiedAt: stat.mtime.toISOString() });
  };
  const walk = async (rel, depth) => {
    const entries = await fsp.readdir(path.join(gameDir, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const child = path.join(rel, entry.name);
      if (entry.isDirectory() && depth < MAX_DEPTH) await walk(child, depth + 1);
      else if (entry.isFile() && TEXT.test(entry.name)) await add(child);
    }
  };

  for (const name of ROOT_FILES) await add(name);
  await walk(CONFIG_DIR, 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Resolves a path from the renderer, refusing anything outside config/ (or not a text file). */
async function resolve(profileId, rel) {
  await profiles.get(profileId);
  const gameDir = profiles.gameDir(profileId);
  const clean = String(rel ?? '');
  const full = path.resolve(gameDir, clean);
  const inConfig = full.startsWith(path.join(gameDir, CONFIG_DIR) + path.sep);
  const isRootFile = ROOT_FILES.some((name) => full === path.join(gameDir, name));
  if ((!inConfig && !isRootFile) || !TEXT.test(full)) throw new Error('That isn’t a config file.');
  return full;
}

/** { text, modifiedAt } where modifiedAt is the file's mtime in ms, for spotting outside changes. */
async function read(profileId, rel) {
  const full = await resolve(profileId, rel);
  const stat = await fsp.stat(full);
  if (stat.size > MAX_SIZE) throw new Error('That file is too big to edit here. Open the folder instead.');
  const buf = await fsp.readFile(full);
  if (buf.includes(0)) throw new Error('That file isn’t plain text.');
  return { text: buf.toString('utf8'), modifiedAt: stat.mtimeMs };
}

/**
 * Saves a file. If it changed on disk since `baseModifiedAt` (a mod rewrote it), nothing is written
 * and { conflict: true } comes back, unless `force` is set.
 */
async function write(profileId, rel, text, baseModifiedAt, force = false) {
  const full = await resolve(profileId, rel);
  const stat = await fsp.stat(full).catch(() => null);
  if (!force && stat && baseModifiedAt != null && Math.abs(stat.mtimeMs - baseModifiedAt) > 1) return { conflict: true };
  await fsp.writeFile(full, String(text));
  return { conflict: false, modifiedAt: (await fsp.stat(full)).mtimeMs };
}

async function reveal(profileId, rel) {
  shell.showItemInFolder(await resolve(profileId, rel));
}

module.exports = { list, read, write, reveal };
