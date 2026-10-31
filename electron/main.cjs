const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');
const { registerIpc } = require('./ipc.cjs');
const { titleBarOverlay } = require('./titlebar.cjs');

function createWindow() {
  const frame =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors) };

  const win = new BrowserWindow({
    ...frame,
    width: 1160,
    height: 770,
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
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
