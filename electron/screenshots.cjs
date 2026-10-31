const fsp = require('node:fs/promises');
const path = require('node:path');
const { clipboard, nativeImage, shell } = require('electron');
const profiles = require('./profiles.cjs');
const { safeFileName } = require('./content.cjs');

// Screenshots the game saved in a profile's screenshots/ folder.

const IMAGE = /\.(png|jpe?g)$/i;
const THUMB_WIDTH = 480;
const THUMB_CACHE_SIZE = 300;

const dir = (profileId) => path.join(profiles.gameDir(profileId), 'screenshots');

async function file(profileId, fileName) {
  await profiles.get(profileId);
  const name = safeFileName(fileName);
  if (!IMAGE.test(name)) throw new Error('Not a screenshot.');
  return path.join(dir(profileId), name);
}

/** Newest first: [{ fileName, takenAt, size }]. */
async function list(profileId) {
  await profiles.get(profileId);
  const entries = await fsp.readdir(dir(profileId), { withFileTypes: true }).catch(() => []);
  const shots = [];
  for (const entry of entries) {
    if (!entry.isFile() || !IMAGE.test(entry.name)) continue;
    const { mtime, size } = await fsp.stat(path.join(dir(profileId), entry.name));
    shots.push({ fileName: entry.name, takenAt: mtime.toISOString(), size });
  }
  return shots.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

async function remove(profileId, fileName) {
  await fsp.rm(await file(profileId, fileName), { force: true });
  return list(profileId);
}

async function copy(profileId, fileName) {
  const image = nativeImage.createFromPath(await file(profileId, fileName));
  if (image.isEmpty()) throw new Error('Couldn’t read that screenshot.');
  clipboard.writeImage(image);
}

async function reveal(profileId, fileName) {
  shell.showItemInFolder(await file(profileId, fileName));
}

// Full-size screenshots are several MB each; the gallery grid gets small JPEGs instead.
const thumbs = new Map();

/** { buf, type } for the protocol handler: the image itself, or a thumbnail. */
async function read(profileId, fileName, thumb) {
  const full = await file(profileId, fileName);
  const { mtimeMs } = await fsp.stat(full);
  if (!thumb) return { buf: await fsp.readFile(full), type: /\.png$/i.test(full) ? 'image/png' : 'image/jpeg' };

  const key = `${full}:${mtimeMs}`;
  let buf = thumbs.get(key);
  if (!buf) {
    const image = nativeImage.createFromPath(full);
    if (image.isEmpty()) throw new Error('Unreadable image.');
    const { width } = image.getSize();
    buf = (width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image).toJPEG(82);
    thumbs.set(key, buf);
    if (thumbs.size > THUMB_CACHE_SIZE) thumbs.delete(thumbs.keys().next().value);
  }
  return { buf, type: 'image/jpeg' };
}

module.exports = { list, remove, copy, reveal, read };
