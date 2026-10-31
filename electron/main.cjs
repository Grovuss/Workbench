const { app, BrowserWindow, nativeTheme, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { registerIpc } = require('./ipc.cjs');
const { titleBarOverlay } = require('./titlebar.cjs');
const icons = require('./icons.cjs');
const screenshots = require('./screenshots.cjs');
const background = require('./background.cjs');
const skins = require('./skins.cjs');
const opened = require('./opened.cjs');
const updater = require('./updater.cjs');

// One Workbench at a time. Opening a pack file while it runs hands the file to the open window.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) {
  app.quit();
} else {
  opened.opened(opened.packFromArgs(process.argv));
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    opened.opened(opened.packFromArgs(argv));
  });
}
app.on('open-file', (e, file) => {
  e.preventDefault();
  opened.opened(file);
});

// workbench:// serves local images to the renderer:
//   profile-icon/<id>, screenshot/<profileId>/<file>[?thumb=1], skin/<libraryId>
protocol.registerSchemesAsPrivileged([{ scheme: 'workbench', privileges: { standard: true, secure: true } }]);

const PROFILE_ID = /^[0-9a-f-]{36}$/;

function registerProtocol() {
  protocol.handle('workbench', async (request) => {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    if (url.hostname === 'profile-icon' && PROFILE_ID.test(id)) {
      const icon = await icons.read(id);
      if (icon) return new Response(icon.buf, { headers: { 'Content-Type': icon.type, 'Cache-Control': 'no-cache' } });
    }
    if (url.hostname === 'screenshot') {
      const [profileId, file] = id.split('/');
      if (PROFILE_ID.test(profileId) && file) {
        const image = await screenshots.read(profileId, decodeURIComponent(file), url.searchParams.has('thumb')).catch(() => null);
        if (image) return new Response(image.buf, { headers: { 'Content-Type': image.type } });
      }
    }
    if (url.hostname === 'background') {
      const image = await background.read();
      if (image) return new Response(image.buf, { headers: { 'Content-Type': image.type, 'Cache-Control': 'no-cache' } });
    }
    if (url.hostname === 'skin') {
      const buf = await skins.read(id);
      if (buf) return new Response(buf, { headers: { 'Content-Type': 'image/png' } });
    }
    return new Response(null, { status: 404 });
  });
}

/** How the app looked when it last ran ({ dark, background, sidebar, text, zoom }), so the window opens that way. */
function lastLook() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window.json'), 'utf8'));
  } catch {
    return { dark: nativeTheme.shouldUseDarkColors };
  }
}

function createWindow() {
  const look = lastLook();
  const frame =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(look) };

  const win = new BrowserWindow({
    ...frame,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Workbench',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: look.background ?? (look.dark ? '#1c1c1d' : '#fef3dd'),
    // Shown once the splash has painted, so it never opens blank.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: look.zoom ?? 1,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  if (!isFirstInstance) return;
  registerProtocol();
  registerIpc();
  createWindow();
  require('./discord.cjs').start();
  const { broadcast } = require('./game.cjs');
  opened.listen((file) => broadcast({ type: 'open-pack', path: file }));
  updater.start(broadcast);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
