const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');
const { shell } = require('electron');
const nbt = require('./nbt.cjs');
const paths = require('./paths.cjs');
const profiles = require('./profiles.cjs');
const settings = require('./settings.cjs');
const { safeFileName } = require('./content.cjs');

// Worlds in a profile's saves/ folder, and their backups in <userData>/backups/<profile>/<world>/<stamp>/.

const BACKUP_META = 'workbench-backup.json';
const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'];

const savesDir = (profileId) => path.join(profiles.gameDir(profileId), 'saves');
const backupsDir = (profileId, folder) => path.join(paths.root(), 'backups', profileId, folder);

/** The folder of an existing world, refusing names that would leave saves/. */
async function worldDir(profileId, folder) {
  await profiles.get(profileId);
  const dir = path.join(savesDir(profileId), safeFileName(folder));
  if (!(await exists(path.join(dir, 'level.dat')))) throw new Error('That world doesn’t exist any more.');
  return dir;
}

const exists = (p) => fsp.access(p).then(() => true, () => false);

async function dirSize(dir) {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += (await fsp.stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

// ---------- level.dat ----------

async function readLevelDat(dir) {
  return nbt.read(zlib.gunzipSync(await fsp.readFile(path.join(dir, 'level.dat'))));
}

/** Name, mode and version from level.dat; anything unreadable falls back to null. */
async function levelInfo(dir) {
  try {
    const data = (await readLevelDat(dir)).value.Data?.value ?? {};
    const lastPlayed = data.LastPlayed?.value;
    return {
      name: data.LevelName?.value || null,
      lastPlayedAt: lastPlayed ? new Date(Number(lastPlayed)).toISOString() : null,
      gameMode: GAME_MODES[data.GameType?.value] ?? null,
      hardcore: data.hardcore?.value === 1,
      version: data.Version?.value?.Name?.value ?? null,
    };
  } catch {
    return { name: null, lastPlayedAt: null, gameMode: null, hardcore: false, version: null };
  }
}

/** Changes the name shown in game. The folder keeps its name, like renaming in game does. */
async function setLevelName(dir, name) {
  const root = await readLevelDat(dir);
  const data = root.value.Data?.value;
  if (!data) throw new Error('This world’s level.dat can’t be read.');
  data.LevelName = { type: 'string', value: name };
  const file = path.join(dir, 'level.dat');
  await fsp.writeFile(`${file}.tmp`, zlib.gzipSync(nbt.write(root)));
  await fsp.rename(`${file}.tmp`, file);
}

function cleanName(name) {
  const clean = String(name ?? '').trim().slice(0, 64);
  if (!clean) throw new Error('Give the world a name.');
  return clean;
}

/** A folder name in saves/ that isn't taken, based on the world's name. */
async function freeFolder(saves, name) {
  const base = name.replace(/[\\/:*?"<>|.]/g, '_').trim().slice(0, 48) || 'World';
  for (let i = 1; ; i++) {
    const folder = i === 1 ? base : `${base} (${i})`;
    if (!(await exists(path.join(saves, folder)))) return folder;
  }
}

// ---------- Worlds ----------

async function list(profileId) {
  await profiles.get(profileId);
  const saves = savesDir(profileId);
  const entries = await fsp.readdir(saves, { withFileTypes: true }).catch(() => []);
  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(saves, entry.name);
    const stat = await fsp.stat(path.join(dir, 'level.dat')).catch(() => null);
    if (!stat) continue;
    const [info, icon, sizeBytes, backups] = await Promise.all([
      levelInfo(dir),
      fsp.readFile(path.join(dir, 'icon.png')).catch(() => null),
      dirSize(dir),
      listBackups(profileId, entry.name),
    ]);
    worlds.push({
      folder: entry.name,
      name: info.name ?? entry.name,
      lastPlayedAt: info.lastPlayedAt ?? stat.mtime.toISOString(),
      gameMode: info.gameMode,
      hardcore: info.hardcore,
      version: info.version,
      sizeBytes,
      icon: icon ? `data:image/png;base64,${icon.toString('base64')}` : null,
      backupCount: backups.length,
      lastBackupAt: backups[0]?.createdAt ?? null,
    });
  }
  return worlds.sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
}

async function rename(profileId, folder, name) {
  await setLevelName(await worldDir(profileId, folder), cleanName(name));
  return list(profileId);
}

/** Copies a world into a profile (the same one, or another). Returns the new folder name. */
async function copy(profileId, folder, targetProfileId = profileId) {
  const from = await worldDir(profileId, folder);
  await profiles.get(targetProfileId);
  const { name } = await levelInfo(from);
  const sameProfile = targetProfileId === profileId;
  const newName = sameProfile ? `${name ?? folder} (copy)` : (name ?? folder);
  const saves = savesDir(targetProfileId);
  const dest = path.join(saves, await freeFolder(saves, newName));
  await fsp.mkdir(saves, { recursive: true });
  await fsp.cp(from, dest, { recursive: true });
  await fsp.rm(path.join(dest, 'session.lock'), { force: true });
  if (sameProfile) await setLevelName(dest, newName).catch(() => {});
  return path.basename(dest);
}

/** Moves a world to another profile; the original goes to the Recycle Bin. */
async function move(profileId, folder, targetProfileId) {
  if (targetProfileId === profileId) throw new Error('Pick a different profile.');
  await copy(profileId, folder, targetProfileId);
  await shell.trashItem(await worldDir(profileId, folder));
  return list(profileId);
}

/** Sends a world to the Recycle Bin, so it can still be recovered. Its backups are kept. */
async function remove(profileId, folder) {
  await shell.trashItem(await worldDir(profileId, folder));
  return list(profileId);
}

/** Adds a world from a folder or a .zip (the folder holding level.dat may be nested). */
async function importWorld(profileId, source) {
  await profiles.get(profileId);
  const saves = savesDir(profileId);
  await fsp.mkdir(saves, { recursive: true });
  const stat = await fsp.stat(source);

  if (stat.isDirectory()) {
    if (!(await exists(path.join(source, 'level.dat')))) throw new Error('That folder isn’t a Minecraft world (there’s no level.dat in it).');
    await readLevelDat(source).catch(() => {
      throw new Error('That world’s level.dat is damaged.');
    });
    const { name } = await levelInfo(source);
    const dest = path.join(saves, await freeFolder(saves, name ?? path.basename(source)));
    await fsp.cp(source, dest, { recursive: true });
    await fsp.rm(path.join(dest, 'session.lock'), { force: true });
    return list(profileId);
  }

  const zip = new AdmZip(source);
  const level = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /(^|\/)level\.dat$/.test(e.entryName))
    .sort((a, b) => a.entryName.length - b.entryName.length)[0];
  if (!level) throw new Error('That zip doesn’t contain a Minecraft world.');
  const prefix = level.entryName.slice(0, -'level.dat'.length);
  const fallback = prefix ? path.basename(prefix) : path.basename(source, path.extname(source));
  const dest = path.join(saves, await freeFolder(saves, fallback));
  const root = path.resolve(dest);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const target = path.resolve(root, entry.entryName.slice(prefix.length));
    if (!target.startsWith(root + path.sep)) throw new Error('That zip contains an unsafe path.');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.getData());
  }
  await fsp.rm(path.join(dest, 'session.lock'), { force: true });
  if (!(await readLevelDat(dest).then(() => true, () => false))) {
    await fsp.rm(dest, { recursive: true, force: true });
    throw new Error('That zip’s world is damaged (its level.dat can’t be read).');
  }
  return list(profileId);
}

// ---------- Backups ----------

/** Newest first: [{ id, kind, createdAt, sizeBytes }]. kind: auto, manual, restore or update. */
async function listBackups(profileId, folder) {
  const dir = backupsDir(profileId, safeFileName(folder));
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await fsp
      .readFile(path.join(dir, entry.name, BACKUP_META), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (meta) backups.push({ id: entry.name, kind: meta.kind, createdAt: meta.createdAt, sizeBytes: meta.sizeBytes });
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function backup(profileId, folder, kind = 'manual') {
  const from = await worldDir(profileId, folder);
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${kind}`;
  const dest = path.join(backupsDir(profileId, path.basename(from)), id);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.cp(from, dest, { recursive: true });
    await fsp.rm(path.join(dest, 'session.lock'), { force: true });
    await fsp.writeFile(path.join(dest, BACKUP_META), JSON.stringify({ kind, createdAt, sizeBytes: await dirSize(dest) }));
  } catch (err) {
    await fsp.rm(dest, { recursive: true, force: true });
    throw err;
  }

  // Only automatic backups are pruned; ones the player made stay until they delete them.
  const autos = (await listBackups(profileId, folder)).filter((b) => b.kind === 'auto');
  for (const old of autos.slice((await settings.get()).backupsToKeep)) {
    await fsp.rm(path.join(backupsDir(profileId, path.basename(from)), old.id), { recursive: true, force: true });
  }
  return listBackups(profileId, folder);
}

function backupPath(profileId, folder, id) {
  const name = safeFileName(id);
  return path.join(backupsDir(profileId, safeFileName(folder)), name);
}

/** Puts a backup back in place. The world as it is now is backed up first, so restoring can be undone. */
async function restore(profileId, folder, id) {
  await profiles.get(profileId);
  const source = backupPath(profileId, folder, id);
  if (!(await exists(path.join(source, BACKUP_META)))) throw new Error('That backup doesn’t exist any more.');
  const dir = path.join(savesDir(profileId), safeFileName(folder));
  if (await exists(path.join(dir, 'level.dat'))) await backup(profileId, folder, 'restore');
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.cp(source, dir, { recursive: true });
  await fsp.rm(path.join(dir, BACKUP_META), { force: true });
  return listBackups(profileId, folder);
}

async function removeBackup(profileId, folder, id) {
  await profiles.get(profileId);
  await fsp.rm(backupPath(profileId, folder, id), { recursive: true, force: true });
  return listBackups(profileId, folder);
}

/** Backups of a world whose world folder was deleted can still be restored, so they stay listable. */
async function revealBackups(profileId, folder) {
  await profiles.get(profileId);
  const dir = backupsDir(profileId, safeFileName(folder));
  await fsp.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
}

/**
 * Backs up every world played since its last backup. Runs after the game closes (and before
 * modpack updates) when automatic backups are on.
 */
async function backupChanged(profileId, kind = 'auto') {
  if (!(await settings.get()).autoBackup) return 0;
  const saves = savesDir(profileId);
  const entries = await fsp.readdir(saves, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const stat = await fsp.stat(path.join(saves, entry.name, 'level.dat')).catch(() => null);
    if (!stat) continue;
    const [latest] = await listBackups(profileId, entry.name);
    if (latest && new Date(latest.createdAt) >= stat.mtime) continue;
    await backup(profileId, entry.name, kind);
    count++;
  }
  return count;
}

/** Removes every backup of a profile, when the profile itself is deleted. */
const removeAllBackups = (profileId) => fsp.rm(path.join(paths.root(), 'backups', profileId), { recursive: true, force: true });

module.exports = {
  list,
  listBackups: async (profileId, folder) => (await profiles.get(profileId), listBackups(profileId, folder)),
  rename,
  copy,
  move,
  remove,
  importWorld,
  backup,
  restore,
  removeBackup,
  revealBackups,
  backupChanged,
  removeAllBackups,
};
