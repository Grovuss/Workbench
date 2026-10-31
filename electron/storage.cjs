const fsp = require('node:fs/promises');
const path = require('node:path');
const paths = require('./paths.cjs');
const { dirSize } = require('./store.cjs');

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
