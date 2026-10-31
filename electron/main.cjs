const { app, BrowserWindow, nativeTheme, protocol } = require('electron');
const path = require('node:path');
const { registerIpc } = require('./ipc.cjs');
const { titleBarOverlay } = require('./titlebar.cjs');
const icons = require('./icons.cjs');
const screenshots = require('./screenshots.cjs');
const skins = require('./skins.cjs');

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
    if (url.hostname === 'skin') {
      const buf = await skins.read(id);
      if (buf) return new Response(buf, { headers: { 'Content-Type': 'image/png' } });
    }
    return new Response(null, { status: 404 });
  });
}

function createWindow() {
  const frame =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors) };

  const win = new BrowserWindow({
    ...frame,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Workbench',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1d' : '#fef3dd',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  registerProtocol();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
