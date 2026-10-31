const fsp = require('node:fs/promises');
const path = require('node:path');
const { nativeImage } = require('electron');
const profiles = require('./profiles.cjs');

const ICON_SIZE = 256;
const MAX_RAW_BYTES = 2 * 1024 * 1024;

const iconFile = (profileId) => path.join(profiles.gameDir(profileId), 'workbench-icon');

// Magic numbers for the formats we store; anything else is rejected.
function imageType(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return null;
}

/** Center-crops to a square and shrinks to ICON_SIZE; formats Electron can't decode are kept as-is. */
function prepare(buf) {
  const type = imageType(buf);
  if (!type) throw new Error('Pick a PNG, JPEG, WebP or GIF image.');
  const image = nativeImage.createFromBuffer(buf);
  // Keep GIFs raw so animation survives.
  if (image.isEmpty() || type === 'image/gif') {
    if (buf.length > MAX_RAW_BYTES) throw new Error('That image is too large (2 MB max).');
    return buf;
  }
  const { width, height } = image.getSize();
  const side = Math.min(width, height);
  const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  return (side > ICON_SIZE ? square.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' }) : square).toPNG();
}

async function setFromBuffer(profileId, buf) {
  await profiles.get(profileId);
  await fsp.writeFile(iconFile(profileId), prepare(buf));
  // The timestamp doubles as a cache-buster for the icon URL.
  return profiles.update(profileId, { icon: new Date().toISOString() });
}

async function setFromFile(profileId, filePath) {
  const { size } = await fsp.stat(filePath);
  if (size > 20 * 1024 * 1024) throw new Error('That image is too large.');
  return setFromBuffer(profileId, await fsp.readFile(filePath));
}

async function remove(profileId) {
  await fsp.rm(iconFile(profileId), { force: true });
  return profiles.update(profileId, { icon: null });
}

/** The stored icon with its content type, or null. */
async function read(profileId) {
  const buf = await fsp.readFile(iconFile(profileId)).catch(() => null);
  const type = buf && imageType(buf);
  return type ? { buf, type } : null;
}

module.exports = { setFromBuffer, setFromFile, remove, read };
