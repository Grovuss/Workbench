const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

contextBridge.exposeInMainWorld('workbench', {
  platform: process.platform,
  profiles: {
    list: () => invoke('profiles:list'),
    create: (input) => invoke('profiles:create', input),
    delete: (id) => invoke('profiles:delete', id),
    rename: (id, name) => invoke('profiles:rename', id, name),
    setVersion: (id, selection) => invoke('profiles:setVersion', id, selection),
    updateSettings: (id, patch) => invoke('profiles:updateSettings', id, patch),
    worlds: (id) => invoke('profiles:worlds', id),
    readLog: (id) => invoke('profiles:readLog', id),
    openFolder: (id, sub) => invoke('profiles:openFolder', id, sub),
    setIcon: (id) => invoke('profiles:setIcon', id),
    removeIcon: (id) => invoke('profiles:removeIcon', id),
    duplicate: (id, name) => invoke('profiles:duplicate', id, name),
  },
  worlds: {
    rename: (id, folder, name) => invoke('worlds:rename', id, folder, name),
    copy: (id, folder, targetId) => invoke('worlds:copy', id, folder, targetId),
    move: (id, folder, targetId) => invoke('worlds:move', id, folder, targetId),
    remove: (id, folder) => invoke('worlds:remove', id, folder),
    import: (id, kind) => invoke('worlds:import', id, kind),
    importPath: (id, filePath) => invoke('worlds:importPath', id, filePath),
    backups: (id, folder) => invoke('worlds:backups', id, folder),
    backup: (id, folder) => invoke('worlds:backup', id, folder),
    restore: (id, folder, backupId) => invoke('worlds:restore', id, folder, backupId),
    removeBackup: (id, folder, backupId) => invoke('worlds:removeBackup', id, folder, backupId),
    revealBackups: (id, folder) => invoke('worlds:revealBackups', id, folder),
  },
  share: {
    create: (id) => invoke('share:create', id),
    preview: (code) => invoke('share:preview', code),
    import: (code) => invoke('share:import', code),
  },
  serverPack: {
    export: (id) => invoke('serverpack:export', id),
  },
  logs: {
    upload: (text) => invoke('logs:upload', text),
    open: (url) => invoke('logs:open', url),
  },
  modSets: {
    list: () => invoke('modsets:list'),
    create: (name, entries) => invoke('modsets:create', name, entries),
    update: (id, patch) => invoke('modsets:update', id, patch),
    remove: (id) => invoke('modsets:remove', id),
  },
  configs: {
    list: (id) => invoke('configs:list', id),
    read: (id, rel) => invoke('configs:read', id, rel),
    write: (id, rel, text, baseModifiedAt, force) => invoke('configs:write', id, rel, text, baseModifiedAt, force),
    reveal: (id, rel) => invoke('configs:reveal', id, rel),
  },
  screenshots: {
    list: (id) => invoke('screenshots:list', id),
    remove: (id, fileName) => invoke('screenshots:remove', id, fileName),
    setCover: (id, fileName) => invoke('screenshots:setCover', id, fileName),
    copy: (id, fileName) => invoke('screenshots:copy', id, fileName),
    reveal: (id, fileName) => invoke('screenshots:reveal', id, fileName),
  },
  diagnose: {
    scan: (id) => invoke('diagnose:scan', id),
    installDependency: (id, modId) => invoke('diagnose:installDependency', id, modId),
    openCrashReport: (id, name) => invoke('diagnose:openCrashReport', id, name),
  },
  skins: {
    state: () => invoke('skins:state'),
    reset: () => invoke('skins:reset'),
    setCape: (capeId) => invoke('skins:setCape', capeId),
    wear: (id) => invoke('skins:wear', id),
    library: () => invoke('skins:library'),
    pick: () => invoke('skins:pick'),
    addFiles: (filePaths) => invoke('skins:addFiles', filePaths),
    saveCurrent: () => invoke('skins:saveCurrent'),
    update: (id, patch) => invoke('skins:update', id, patch),
    remove: (id) => invoke('skins:remove', id),
  },
  modpacks: {
    search: (options) => invoke('modpacks:search', options),
    versions: (projectId) => invoke('modpacks:versions', projectId),
    install: (projectId, versionId) => invoke('modpacks:install', projectId, versionId),
    checkUpdate: (id) => invoke('modpacks:checkUpdate', id),
    update: (id, versionId) => invoke('modpacks:update', id, versionId),
  },
  versions: {
    list: () => invoke('versions:list'),
  },
  servers: {
    list: (id) => invoke('servers:list', id),
    add: (id, input) => invoke('servers:add', id, input),
    update: (id, index, input) => invoke('servers:update', id, index, input),
    remove: (id, index) => invoke('servers:remove', id, index),
    ping: (address) => invoke('servers:ping', address),
  },
  // `target` is { profileId, kind: 'mod' | 'resourcepack' | 'shader' | 'datapack', world? }.
  content: {
    list: (target) => invoke('content:list', target),
    openFolder: (target) => invoke('content:openFolder', target),
    search: (target, options) => invoke('content:search', target, options),
    searchAll: (id, options) => invoke('content:searchAll', id, options),
    categories: (kind) => invoke('content:categories', kind),
    install: (target, projectId, versionId) => invoke('content:install', target, projectId, versionId),
    installMany: (target, projectIds) => invoke('content:installMany', target, projectIds),
    performance: (id) => invoke('content:performance', id),
    versions: (target, projectId) => invoke('content:versions', target, projectId),
    project: (projectId) => invoke('content:project', projectId),
    addFiles: (target, filePaths) => invoke('content:addFiles', target, filePaths),
    addAny: (id, filePaths) => invoke('content:addAny', id, filePaths),
    pickFiles: (id, target) => invoke('content:pickFiles', id, target),
    checkUpdates: (target) => invoke('content:checkUpdates', target),
    changelog: (target, fileName) => invoke('content:changelog', target, fileName),
    update: (target, fileNames) => invoke('content:update', target, fileNames),
    remove: (target, fileName) => invoke('content:remove', target, fileName),
    setEnabled: (target, fileName, enabled) => invoke('content:setEnabled', target, fileName, enabled),
  },
  packs: {
    import: (kind) => invoke('packs:import', kind),
    importFile: (filePath) => invoke('packs:importFile', filePath),
    export: (id, include) => invoke('packs:export', id, include),
  },
  // Dropped files carry no path in the renderer; Electron resolves it here.
  pathForFile: (file) => webUtils.getPathForFile(file),
  loaders: {
    games: (loader) => invoke('loaders:games', loader),
    versions: (loader, mcVersion) => invoke('loaders:versions', loader, mcVersion),
  },
  accounts: {
    list: () => invoke('accounts:list'),
    login: () => invoke('accounts:login'),
    logout: (id) => invoke('accounts:logout', id),
    setActive: (id) => invoke('accounts:setActive', id),
  },
  game: {
    launch: (id, quickPlay) => invoke('game:launch', id, quickPlay),
    stop: (id) => invoke('game:stop', id),
    status: () => invoke('game:status'),
    onEvent: (callback) => {
      const listener = (_e, event) => callback(event);
      ipcRenderer.on('game:event', listener);
      return () => ipcRenderer.removeListener('game:event', listener);
    },
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
    reset: () => invoke('settings:reset'),
  },
  system: {
    info: () => invoke('system:info'),
    openDataFolder: () => invoke('system:openDataFolder'),
    openLink: (url) => invoke('system:openLink', url),
    usage: () => invoke('system:usage'),
    openCurseForge: (url) => invoke('system:openCurseForge', url),
    removeJava: () => invoke('system:removeJava'),
    takeOpenedFile: () => invoke('system:takeOpenedFile'),
  },
  updates: {
    status: () => invoke('updates:status'),
    check: () => invoke('updates:check'),
    install: () => invoke('updates:install'),
  },
  window: {
    setTheme: (dark) => invoke('window:setTheme', dark),
  },
});
