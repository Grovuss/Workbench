const fsp = require('node:fs/promises');
const path = require('node:path');

const parse = async (file) => JSON.parse(await fsp.readFile(file, 'utf8'));

/**
 * Reads a JSON file written by writeJson. If it's damaged (a power cut can leave it empty or
 * full of zero bytes), falls back to the last good copy in "<file>.bak". When both are gone or
 * damaged, the damaged file is set aside and `recover()` (or `fallback`) supplies a fresh start.
 */
async function readJson(file, fallback, { recover } = {}) {
  let error;
  try {
    return await parse(file);
  } catch (err) {
    error = err;
  }
  try {
    const data = await parse(`${file}.bak`);
    console.warn(`[store] ${path.basename(file)} was unreadable (${error.message}); using the backup.`);
    await writeJson(file, data).catch(() => {});
    return data;
  } catch {
    // No usable backup either.
  }
  if (error.code === 'ENOENT') {
    if (recover) return recover();
    if (fallback !== undefined) return fallback;
    throw error;
  }
  if (!recover && fallback === undefined) throw error;
  console.warn(`[store] ${path.basename(file)} is damaged and has no backup (${error.message}); starting it over.`);
  await fsp.rename(file, `${file}.damaged-${Date.now()}`).catch(() => {});
  return recover ? recover() : fallback;
}

/** Writes through a temp file that's flushed to disk before it replaces the real one. */
async function writeDurably(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, file);
}

// Each save is flushed to disk, then copied to "<file>.bak", so turning the PC off mid-save
// leaves at least one good copy for readJson.
async function writeJson(file, data, { backup = true } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const text = JSON.stringify(data, null, 2);
  await writeDurably(file, text);
  if (backup) await writeDurably(`${file}.bak`, text);
}

// Serializes read-modify-write cycles on a single file.
function createLock() {
  let queue = Promise.resolve();
  return (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
}

const exists = (file) => fsp.access(file).then(() => true, () => false);

/** Bytes in a folder and everything under it; 0 if it doesn't exist. */
async function dirSize(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(
    entries.map(async (e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return dirSize(full);
      if (!e.isFile()) return 0;
      return (await fsp.stat(full).catch(() => ({ size: 0 }))).size;
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

module.exports = { readJson, writeJson, createLock, exists, dirSize };
