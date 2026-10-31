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
  },
  versions: {
    list: () => invoke('versions:list'),
  },
  mods: {
    list: (id) => invoke('mods:list', id),
    search: (id, query) => invoke('mods:search', id, query),
    install: (id, projectId) => invoke('mods:install', id, projectId),
    remove: (id, fileName) => invoke('mods:remove', id, fileName),
    setEnabled: (id, fileName, enabled) => invoke('mods:setEnabled', id, fileName, enabled),
  },
  packs: {
    import: (kind) => invoke('packs:import', kind),
    importFile: (filePath) => invoke('packs:importFile', filePath),
    export: (id, include) => invoke('packs:export', id, include),
    // Dropped files carry no path in the renderer; Electron resolves it here.
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
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
  },
  window: {
    setTheme: (dark) => invoke('window:setTheme', dark),
  },
});
