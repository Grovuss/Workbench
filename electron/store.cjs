const fsp = require('node:fs/promises');
const path = require('node:path');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

// Write to a temp file then rename, so a crash never leaves half-written JSON.
async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
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
