const fsp = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
const icons = require('./icons.cjs');
const mods = require('./mods.cjs');
const packs = require('./packs.cjs');
const paths = require('./paths.cjs');
const { titleBarOverlay } = require('./titlebar.cjs');
const auth = require('./auth.cjs');
const game = require('./game.cjs');
const profiles = require('./profiles.cjs');
const settings = require('./settings.cjs');
const { getManifest } = require('./launcher/versions.cjs');
const { supportedGameVersions, loaderVersions } = require('./launcher/loaders.cjs');

// Errors cross IPC as { ok: false, error } so the renderer sees our message,
// not Electron's "Error invoking remote method" wrapper.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (err) {
      console.error(`[${channel}]`, err);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}

const PROFILE_SUBFOLDERS = new Set(['saves', 'screenshots', 'logs', 'resourcepacks', 'mods']);

const PACK_FILTERS = {
  workbench: [{ name: 'Workbench pack', extensions: ['workbench'] }],
  mrpack: [{ name: 'Modrinth pack', extensions: ['mrpack'] }],
  any: [{ name: 'Modpacks', extensions: ['workbench', 'mrpack'] }],
};

let importing = false;

async function importPackFile(filePath) {
  if (importing) throw new Error('Another pack is already importing.');
  importing = true;
  try {
    const profile = await packs.importPack(filePath, (p) => game.broadcast({ type: 'import-progress', ...p }));
    game.broadcast({ type: 'profiles-changed' });
    return profile;
  } finally {
    importing = false;
  }
}

async function openDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
}

function registerIpc() {
  handle('profiles:list', () => profiles.list());
  handle('profiles:create', (_e, input) => profiles.create(input));
  handle('profiles:delete', (_e, id) => {
    if (game.isActive(id)) throw new Error('Stop the game before deleting this profile.');
    return profiles.remove(id);
  });
  handle('profiles:rename', (_e, id, name) => profiles.rename(id, name));
  handle('profiles:setVersion', (_e, id, selection) => {
    if (game.isActive(id)) throw new Error('Stop the game before changing its version.');
    return profiles.setVersion(id, selection);
  });
  handle('profiles:updateSettings', (_e, id, patch) => profiles.updateSettings(id, patch));
  handle('profiles:worlds', (_e, id) => profiles.listWorlds(id));
  handle('profiles:readLog', (_e, id) => profiles.readLog(id));
  handle('profiles:setIcon', async (e, id) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Choose profile icon',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    return canceled ? null : icons.setFromFile(id, filePaths[0]);
  });
  handle('profiles:removeIcon', (_e, id) => icons.remove(id));
  handle('profiles:openFolder', async (_e, id, sub) => {
    if (sub !== undefined && !PROFILE_SUBFOLDERS.has(sub)) throw new Error('Unknown folder.');
    await profiles.get(id);
    await openDir(path.join(profiles.gameDir(id), sub ?? ''));
  });

  handle('versions:list', async () =>
    (await getManifest()).versions
      .filter((v) => v.type === 'release' || v.type === 'snapshot')
      .map(({ id, type, releaseTime }) => ({ id, type, releaseTime })),
  );

  handle('mods:list', (_e, id) => mods.list(id));
  handle('mods:search', (_e, id, query) => mods.search(id, query));
  handle('mods:install', (_e, id, projectId) => mods.install(id, projectId));
  handle('mods:addFiles', (_e, id, filePaths) => {
    if (!Array.isArray(filePaths) || !filePaths.length) throw new Error('No files to add.');
    if (game.isActive(id)) throw new Error('Close the game before adding mods.');
    return mods.addFiles(id, filePaths.map(String));
  });
  handle('mods:checkUpdates', (_e, id) => mods.checkUpdates(id));
  handle('mods:update', (_e, id, fileNames) => {
    if (game.isActive(id)) throw new Error('Close the game before updating mods.');
    return mods.update(id, Array.isArray(fileNames) ? fileNames : null);
  });
  handle('mods:remove', (_e, id, fileName) => mods.remove(id, fileName));
  handle('mods:setEnabled', (_e, id, fileName, enabled) => mods.setEnabled(id, fileName, enabled));

  handle('packs:import', async (e, kind) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Import pack',
      properties: ['openFile'],
      filters: PACK_FILTERS[kind] ?? PACK_FILTERS.any,
    });
    return canceled ? null : importPackFile(filePaths[0]);
  });
  handle('packs:importFile', (_e, filePath) => importPackFile(String(filePath)));
  handle('packs:export', async (e, id, include) => {
    const profile = await profiles.get(id);
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Export profile',
      defaultPath: `${profile.name.replace(/[\\/:*?"<>|]/g, '_')}.workbench`,
      filters: PACK_FILTERS.workbench,
    });
    if (canceled || !filePath) return null;
    await packs.exportWorkbench(id, include, filePath);
    shell.showItemInFolder(filePath);
    return filePath;
  });

  handle('loaders:games', (_e, loader) => supportedGameVersions(loader));
  handle('loaders:versions', (_e, loader, mcVersion) => loaderVersions(loader, mcVersion));

  handle('accounts:list', () => auth.listAccounts());
  handle('accounts:login', (e) => auth.login(BrowserWindow.fromWebContents(e.sender)));
  handle('accounts:logout', (_e, id) => auth.logout(id));
  handle('accounts:setActive', (_e, id) => auth.setActive(id));

  // Launch runs in the background and reports through 'game:event'.
  handle('game:launch', (_e, id) => {
    game.launch(id);
  });
  handle('game:stop', (_e, id) => game.stop(id));
  handle('game:status', () => game.status());

  handle('settings:get', () => settings.get());
  handle('settings:set', (_e, patch) => settings.set(patch));

  handle('system:info', () => ({ totalMemoryMb: settings.totalMemoryMb(), dataDir: paths.root() }));
  handle('system:openDataFolder', () => openDir(paths.root()));

  handle('window:setTheme', (e, dark) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && process.platform !== 'darwin') win.setTitleBarOverlay(titleBarOverlay(Boolean(dark)));
  });
}

module.exports = { registerIpc };
