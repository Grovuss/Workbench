const fsp = require('node:fs/promises');
const path = require('node:path');
const nbt = require('./nbt.cjs');
const profiles = require('./profiles.cjs');
const { createLock } = require('./store.cjs');

// The in-game multiplayer list, stored by Minecraft in <gameDir>/servers.dat. Entries keep any
// fields we don't know about, so the game's own data survives our edits.

const withLock = createLock();
const file = (profileId) => path.join(profiles.gameDir(profileId), 'servers.dat');

async function load(profileId) {
  await profiles.get(profileId);
  const buf = await fsp.readFile(file(profileId)).catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  const root = buf ? nbt.read(buf) : { type: 'compound', value: {} };
  const servers = root.value.servers;
  if (!servers || servers.type !== 'list' || (servers.value.length && servers.listType !== 'compound')) {
    root.value.servers = { type: 'list', listType: 'compound', value: [] };
  }
  return root;
}

async function save(profileId, root) {
  const target = file(profileId);
  // Like the game, keep the previous version next to it.
  await fsp.copyFile(target, `${target}_old`).catch(() => {});
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, nbt.write(root));
  await fsp.rename(tmp, target);
}

const str = (entry, key) => (entry[key]?.type === 'string' ? entry[key].value : '');

function toPublic(root) {
  return root.value.servers.value
    .map((entry, index) => ({
      index,
      name: str(entry, 'name') || 'Minecraft Server',
      address: str(entry, 'ip'),
      icon: str(entry, 'icon') ? `data:image/png;base64,${str(entry, 'icon')}` : null,
      hidden: entry.hidden?.value === 1,
    }))
    .filter((s) => !s.hidden)
    .map(({ hidden, ...s }) => s);
}

/** "host", "host:port" or "[v6]:port"; no spaces or schemes. */
function cleanInput({ name, address }) {
  const cleanAddress = String(address ?? '').trim();
  if (!cleanAddress) throw new Error('Enter a server address.');
  if (cleanAddress.length > 255 || /\s|\/|^[a-z]+:\/\//i.test(cleanAddress)) {
    throw new Error('That doesn’t look like a server address. Use something like play.example.com or 1.2.3.4:25565.');
  }
  const cleanName = String(name ?? '').trim().slice(0, 64) || 'Minecraft Server';
  return { name: cleanName, address: cleanAddress };
}

const list = (profileId) => withLock(async () => toPublic(await load(profileId)));

async function add(profileId, input) {
  const { name, address } = cleanInput(input);
  return withLock(async () => {
    const root = await load(profileId);
    root.value.servers.value.push({
      name: { type: 'string', value: name },
      ip: { type: 'string', value: address },
    });
    await save(profileId, root);
    return toPublic(root);
  });
}

function entryAt(root, index) {
  const entry = root.value.servers.value[index];
  if (!Number.isInteger(index) || !entry) throw new Error('That server isn’t in the list anymore.');
  return entry;
}

async function update(profileId, index, input) {
  const { name, address } = cleanInput(input);
  return withLock(async () => {
    const root = await load(profileId);
    const entry = entryAt(root, index);
    // A new address means the old cached icon is for a different server.
    if (str(entry, 'ip') !== address) delete entry.icon;
    entry.name = { type: 'string', value: name };
    entry.ip = { type: 'string', value: address };
    await save(profileId, root);
    return toPublic(root);
  });
}

function remove(profileId, index) {
  return withLock(async () => {
    const root = await load(profileId);
    entryAt(root, index);
    root.value.servers.value.splice(index, 1);
    await save(profileId, root);
    return toPublic(root);
  });
}

module.exports = { list, add, update, remove };
