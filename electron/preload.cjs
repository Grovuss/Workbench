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
  },
  versions: {
    list: () => invoke('versions:list'),
  },
  // `target` is { profileId, kind: 'mod' | 'resourcepack' | 'shader' | 'datapack', world? }.
  content: {
    list: (target) => invoke('content:list', target),
    openFolder: (target) => invoke('content:openFolder', target),
    search: (target, query) => invoke('content:search', target, query),
    install: (target, projectId) => invoke('content:install', target, projectId),
    addFiles: (target, filePaths) => invoke('content:addFiles', target, filePaths),
    checkUpdates: (target) => invoke('content:checkUpdates', target),
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
    launch: (id) => invoke('game:launch', id),
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
  },
  system: {
    info: () => invoke('system:info'),
    openDataFolder: () => invoke('system:openDataFolder'),
    openCurseForge: (url) => invoke('system:openCurseForge', url),
  },
  window: {
    setTheme: (dark) => invoke('window:setTheme', dark),
  },
});
