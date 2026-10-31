const fsp = require('node:fs/promises');
const path = require('node:path');
const paths = require('./paths.cjs');
const { imageType } = require('./icons.cjs');

// The launcher's background picture (Settings → Appearance), kept as one file.
const file = () => path.join(paths.root(), 'background');
const MAX_BYTES = 25 * 1024 * 1024;

/** Copies the picked image in; returns a version string that changes with each new image. */
async function set(filePath) {
  const { size } = await fsp.stat(filePath);
  if (size > MAX_BYTES) throw new Error('That image is too large (25 MB max).');
  const buf = await fsp.readFile(filePath);
  if (!imageType(buf)) throw new Error('Pick a PNG, JPEG, WebP or GIF image.');
  await fsp.writeFile(file(), buf);
  return String(Date.now());
}

const remove = () => fsp.rm(file(), { force: true });

/** The image with its content type, or null. */
async function read() {
  const buf = await fsp.readFile(file()).catch(() => null);
  const type = buf && imageType(buf);
  return type ? { buf, type } : null;
}

module.exports = { set, remove, read };
