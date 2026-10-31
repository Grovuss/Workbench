const fsp = require('node:fs/promises');
const { BrowserWindow, ipcMain, shell } = require('electron');
const paths = require('./paths.cjs');
const auth = require('./auth.cjs');
const game = require('./game.cjs');
const profiles = require('./profiles.cjs');
const settings = require('./settings.cjs');
const { getManifest } = require('./launcher/versions.cjs');

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
  handle('profiles:openFolder', async (_e, id) => {
    await profiles.get(id);
    await openDir(profiles.gameDir(id));
  });

  handle('versions:list', async () =>
    (await getManifest()).versions
      .filter((v) => v.type === 'release' || v.type === 'snapshot')
      .map(({ id, type, releaseTime }) => ({ id, type, releaseTime })),
  );

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
}

module.exports = { registerIpc };
