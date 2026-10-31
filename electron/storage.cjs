const fsp = require('node:fs/promises');
const path = require('node:path');
const paths = require('./paths.cjs');

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

/** What takes up space in the data folder. Shared game files are versions, libraries and assets every profile reuses. */
async function usage() {
  const [profiles, backups, java, meta] = await Promise.all([
    dirSize(paths.profilesDir()),
    dirSize(path.join(paths.root(), 'backups')),
    dirSize(paths.javaDir()),
    dirSize(paths.meta()),
  ]);
  return { profiles, backups, java, shared: Math.max(0, meta - java) };
}

/** Deletes the downloaded Java runtimes; the next launch downloads them again. */
const removeJava = () => fsp.rm(paths.javaDir(), { recursive: true, force: true });

module.exports = { usage, removeJava };
