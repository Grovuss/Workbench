const fsp = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
const icons = require('./icons.cjs');
const content = require('./content.cjs');
const curseforge = require('./curseforge.cjs');
const servers = require('./servers.cjs');
const screenshots = require('./screenshots.cjs');
const skins = require('./skins.cjs');
const diagnose = require('./diagnose.cjs');
const performance = require('./performance.cjs');
const modsets = require('./modsets.cjs');
const configs = require('./configs.cjs');
const worlds = require('./worlds.cjs');
const share = require('./share.cjs');
const discord = require('./discord.cjs');
const { exportServerPack } = require('./serverpack.cjs');
const { ping } = require('./ping.cjs');
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
      // Windows locks files the game has open.
      const locked = err?.code === 'EBUSY' || err?.code === 'EPERM';
      return { ok: false, error: locked ? 'Minecraft is using that file. Close the game and try again.' : (err?.message ?? String(err)) };
    }
  });
}

const PROFILE_SUBFOLDERS = new Set(['saves', 'screenshots', 'logs', 'resourcepacks', 'shaderpacks', 'mods', 'crash-reports']);

/** Validates a content target from the renderer: { profileId, kind, world? }. */
const contentTarget = (t) => ({ profileId: String(t?.profileId), kind: String(t?.kind), world: t?.world == null ? undefined : String(t.world) });

/** { server: 'host[:port]' } or { world: '<folder>' }; these end up as game arguments. */
function cleanQuickPlay(quickPlay) {
  if (quickPlay?.server) {
    const server = String(quickPlay.server).trim();
    if (!server || server.length > 255 || /[\s/]/.test(server)) throw new Error('Invalid server address.');
    return { server };
  }
  if (quickPlay?.world) return { world: content.safeFileName(quickPlay.world) };
  return undefined;
}

function assertIdle(profileId, action) {
  if (game.isActive(String(profileId))) throw new Error(`Close the game before ${action}.`);
}

function assertNotRunning(target, action) {
  if (game.isActive(target.profileId)) throw new Error(`Close the game before ${action}.`);
}

const PACK_FILTERS = {
  workbench: [{ name: 'Workbench pack', extensions: ['workbench'] }],
  mrpack: [{ name: 'Modrinth pack', extensions: ['mrpack'] }],
  curseforge: [{ name: 'CurseForge pack', extensions: ['zip'] }],
  any: [{ name: 'Modpacks', extensions: ['workbench', 'mrpack', 'zip'] }],
};

let importing = false;

/** Runs one pack import at a time, reporting progress to every window. */
async function runImport(fn) {
  if (importing) throw new Error('Another pack is already importing.');
  importing = true;
  try {
    const result = await fn((p) => game.broadcast({ type: 'import-progress', ...p }));
    game.broadcast({ type: 'profiles-changed' });
    return result;
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
  handle('profiles:delete', async (_e, id) => {
    if (game.isActive(id)) throw new Error('Stop the game before deleting this profile.');
    await profiles.remove(id);
    await worlds.removeAllBackups(String(id)).catch(() => {});
  });
  handle('profiles:rename', (_e, id, name) => profiles.rename(id, name));
  handle('profiles:setVersion', (_e, id, selection) => {
    if (game.isActive(id)) throw new Error('Stop the game before changing its version.');
    return profiles.setVersion(id, selection);
  });
  handle('profiles:updateSettings', (_e, id, patch) => profiles.updateSettings(id, patch));
  handle('profiles:worlds', (_e, id) => worlds.list(String(id)));
  handle('worlds:rename', (_e, id, folder, name) => {
    assertIdle(id, 'renaming a world');
    return worlds.rename(String(id), folder, name);
  });
  handle('worlds:copy', async (_e, id, folder, targetId) => {
    assertIdle(targetId ?? id, 'copying worlds into it');
    await worlds.copy(String(id), folder, String(targetId ?? id));
    return worlds.list(String(id));
  });
  handle('worlds:move', (_e, id, folder, targetId) => {
    assertIdle(id, 'moving a world');
    assertIdle(targetId, 'moving worlds into it');
    return worlds.move(String(id), folder, String(targetId));
  });
  handle('worlds:remove', (_e, id, folder) => {
    assertIdle(id, 'deleting a world');
    return worlds.remove(String(id), folder);
  });
  handle('worlds:import', async (e, id, kind) => {
    assertIdle(id, 'adding worlds');
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: kind === 'zip' ? 'Choose a world .zip' : 'Choose a world folder',
      properties: [kind === 'zip' ? 'openFile' : 'openDirectory'],
      filters: kind === 'zip' ? [{ name: 'World', extensions: ['zip'] }] : undefined,
    });
    return canceled ? null : worlds.importWorld(String(id), filePaths[0]);
  });
  handle('worlds:importPath', (_e, id, filePath) => {
    assertIdle(id, 'adding worlds');
    return worlds.importWorld(String(id), String(filePath));
  });
  handle('worlds:backups', (_e, id, folder) => worlds.listBackups(String(id), folder));
  handle('worlds:backup', (_e, id, folder) => {
    assertIdle(id, 'backing up');
    return worlds.backup(String(id), folder, 'manual');
  });
  handle('worlds:restore', (_e, id, folder, backupId) => {
    assertIdle(id, 'restoring a backup');
    return worlds.restore(String(id), folder, String(backupId));
  });
  handle('worlds:removeBackup', (_e, id, folder, backupId) => worlds.removeBackup(String(id), folder, String(backupId)));
  handle('worlds:revealBackups', (_e, id, folder) => worlds.revealBackups(String(id), folder));
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
  handle('profiles:duplicate', (_e, id, name) => {
    if (game.isActive(String(id))) throw new Error('Close the game before duplicating this profile.');
    return profiles.duplicate(String(id), name);
  });
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

  handle('servers:list', (_e, id) => servers.list(String(id)));
  handle('servers:add', (_e, id, input) => servers.add(String(id), input));
  handle('servers:update', (_e, id, index, input) => servers.update(String(id), Number(index), input));
  handle('servers:remove', (_e, id, index) => servers.remove(String(id), Number(index)));
  handle('servers:ping', (_e, address) => ping(String(address)));

  handle('modsets:list', () => modsets.list());
  handle('modsets:create', (_e, name, entries) => modsets.create(name, entries));
  handle('modsets:update', (_e, id, patch) => modsets.update(String(id), patch ?? {}));
  handle('modsets:remove', (_e, id) => modsets.remove(String(id)));

  handle('configs:list', (_e, id) => configs.list(String(id)));
  handle('configs:read', (_e, id, rel) => configs.read(String(id), rel));
  handle('configs:write', (_e, id, rel, text, baseModifiedAt, force) =>
    configs.write(String(id), rel, text, baseModifiedAt == null ? null : Number(baseModifiedAt), Boolean(force)),
  );
  handle('configs:reveal', (_e, id, rel) => configs.reveal(String(id), rel));

  handle('screenshots:list', (_e, id) => screenshots.list(String(id)));
  handle('screenshots:remove', (_e, id, fileName) => screenshots.remove(String(id), fileName));
  handle('screenshots:setCover', (_e, id, fileName) => screenshots.setCover(String(id), fileName ?? null));
  handle('screenshots:copy', (_e, id, fileName) => screenshots.copy(String(id), fileName));
  handle('screenshots:reveal', (_e, id, fileName) => screenshots.reveal(String(id), fileName));

  handle('diagnose:scan', (_e, id) => diagnose.scanMods(String(id)));
  handle('diagnose:installDependency', (_e, id, modId) => diagnose.installDependency(String(id), String(modId)));
  handle('diagnose:openCrashReport', async (_e, id, name) => {
    await profiles.get(String(id));
    const file = path.join(profiles.gameDir(String(id)), 'crash-reports', content.safeFileName(name));
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
  });

  handle('skins:state', () => skins.state());
  handle('skins:reset', () => skins.reset());
  handle('skins:setCape', (_e, capeId) => skins.setCape(capeId == null ? null : String(capeId)));
  handle('skins:wear', (_e, id) => skins.wear(String(id)));
  handle('skins:library', () => skins.listLibrary());
  handle('skins:pick', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Add skins',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Skins', extensions: ['png'] }],
    });
    return canceled ? null : skins.addFiles(filePaths);
  });
  handle('skins:addFiles', (_e, filePaths) => skins.addFiles((Array.isArray(filePaths) ? filePaths : []).map(String)));
  handle('skins:saveCurrent', () => skins.saveCurrent());
  handle('skins:update', (_e, id, patch) => skins.updateEntry(String(id), patch ?? {}));
  handle('skins:remove', (_e, id) => skins.removeFromLibrary(String(id)));

  handle('modpacks:search', (_e, options) => packs.searchModpacks(options ?? {}));
  handle('modpacks:versions', (_e, projectId) => packs.modpackVersions(String(projectId)));
  handle('modpacks:install', (_e, projectId, versionId) =>
    runImport((progress) => packs.installModpack(String(projectId), versionId == null ? null : String(versionId), progress)),
  );
  handle('modpacks:checkUpdate', (_e, id) => packs.checkModpackUpdate(String(id)));
  handle('modpacks:update', (_e, id, versionId) => {
    assertIdle(id, 'updating the modpack');
    return runImport((progress) => packs.updateModpack(String(id), String(versionId), progress));
  });

  handle('share:create', (_e, id) => share.create(String(id)));
  handle('share:preview', (_e, code) => share.preview(code));
  handle('share:import', (_e, code) => runImport((progress) => share.importCode(code, progress)));

  handle('serverpack:export', async (e, id) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Where should the server folder go?',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled) return null;
    const result = await runImport((progress) => exportServerPack(String(id), filePaths[0], progress));
    shell.openPath(result.folder);
    return result;
  });

  // Uploads a log to mclo.gs (a Minecraft log host) so it can be shared when asking for help.
  handle('logs:upload', async (_e, text) => {
    const body = new URLSearchParams({ content: String(text).slice(0, 10 * 1024 * 1024) });
    const res = await fetch('https://api.mclo.gs/1/log', { method: 'POST', body, headers: { 'User-Agent': content.USER_AGENT } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error ?? `mclo.gs said ${res.status}.`);
    return data.url;
  });
  handle('logs:open', (_e, url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || u.hostname !== 'mclo.gs') throw new Error('Not an mclo.gs link.');
    return shell.openExternal(u.href);
  });

  handle('content:list', (_e, t) => content.list(contentTarget(t)));
  handle('content:openFolder', async (_e, t) => openDir(await content.folder(contentTarget(t))));
  handle('content:search', (_e, t, options) => content.search(contentTarget(t), options));
  handle('content:searchAll', (_e, id, options) => content.searchAll(String(id), options));
  handle('content:categories', (_e, kind) => content.categories(String(kind)));
  handle('content:install', (_e, t, projectId, versionId) =>
    content.install(contentTarget(t), String(projectId), versionId == null ? null : String(versionId)),
  );
  handle('content:installMany', (_e, t, projectIds) =>
    content.installMany(contentTarget(t), (Array.isArray(projectIds) ? projectIds : []).map(String)),
  );
  handle('content:performance', (_e, id) => performance.suggestions(String(id)));
  handle('content:versions', (_e, t, projectId) => content.versions(contentTarget(t), String(projectId)));
  handle('content:addFiles', (_e, t, filePaths) => {
    const target = contentTarget(t);
    if (!Array.isArray(filePaths) || !filePaths.length) throw new Error('No files to add.');
    assertNotRunning(target, 'adding files');
    return content.addFiles(target, filePaths.map(String));
  });
  // Files of any kind, sorted into mods/resource packs/shaders. Resolves to counts per kind.
  handle('content:addAny', (_e, id, filePaths) => {
    if (!Array.isArray(filePaths) || !filePaths.length) throw new Error('No files to add.');
    if (game.isActive(String(id))) throw new Error('Close the game before adding files.');
    return content.addFilesAuto(String(id), filePaths.map(String));
  });
  // With a target (a world's data packs), files go there; otherwise they're sorted like addAny.
  handle('content:pickFiles', async (e, id, t) => {
    if (game.isActive(String(id))) throw new Error('Close the game before adding files.');
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: t ? 'Add data packs' : 'Add mods, resource packs or shaders',
      properties: ['openFile', 'multiSelections'],
      filters: [t ? { name: 'Data packs', extensions: ['zip'] } : { name: 'Mods and packs', extensions: ['jar', 'zip'] }],
    });
    if (canceled) return null;
    if (!t) return content.addFilesAuto(String(id), filePaths);
    const target = contentTarget(t);
    await content.addFiles(target, filePaths);
    return { [target.kind]: filePaths.length };
  });
  handle('content:checkUpdates', (_e, t) => content.checkUpdates(contentTarget(t)));
  handle('content:changelog', (_e, t, fileName) => content.changelog(contentTarget(t), fileName));
  handle('content:update', (_e, t, fileNames) => {
    const target = contentTarget(t);
    assertNotRunning(target, 'updating');
    return content.update(target, Array.isArray(fileNames) ? fileNames : null);
  });
  handle('content:remove', (_e, t, fileName) => content.remove(contentTarget(t), fileName));
  handle('content:setEnabled', (_e, t, fileName, enabled) => content.setEnabled(contentTarget(t), fileName, Boolean(enabled)));

  handle('packs:import', async (e, kind) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Import pack',
      properties: ['openFile'],
      filters: PACK_FILTERS[kind] ?? PACK_FILTERS.any,
    });
    return canceled ? null : runImport((progress) => packs.importPack(filePaths[0], progress));
  });
  handle('packs:importFile', (_e, filePath) => runImport((progress) => packs.importPack(String(filePath), progress)));
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
  handle('game:launch', (_e, id, quickPlay) => {
    game.launch(id, cleanQuickPlay(quickPlay));
  });
  handle('game:stop', (_e, id) => game.stop(id));
  handle('game:status', () => game.status());

  handle('settings:get', () => settings.get());
  handle('settings:set', async (_e, patch) => {
    const next = await settings.set(patch ?? {});
    if ('discordPresence' in (patch ?? {})) discord.settingsChanged();
    return next;
  });

  handle('system:info', () => ({
    totalMemoryMb: settings.totalMemoryMb(),
    dataDir: paths.root(),
    curseforge: curseforge.enabled(),
    discord: discord.configured(),
  }));
  // Only CurseForge pages, for files a pack import couldn't download.
  handle('system:openCurseForge', (_e, url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || u.hostname !== 'www.curseforge.com') throw new Error('Not a CurseForge link.');
    return shell.openExternal(u.href);
  });
  handle('system:openDataFolder', () => openDir(paths.root()));

  handle('window:setTheme', (e, dark) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && process.platform !== 'darwin') win.setTitleBarOverlay(titleBarOverlay(Boolean(dark)));
  });
}

module.exports = { registerIpc };
