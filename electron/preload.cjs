const { contextBridge, ipcRenderer } = require('electron');

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
    openFolder: (id) => invoke('profiles:openFolder', id),
  },
  versions: {
    list: () => invoke('versions:list'),
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
});
