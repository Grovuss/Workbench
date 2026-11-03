const { app, shell } = require('electron');

// Updates come from the GitHub Releases that electron-builder publishes (see "publish" in
// package.json). They download in the background and install on restart, or when the app quits.
// Only packaged builds update; dev runs report 'unsupported'.
// macOS only installs updates signed by a paid Apple developer account, which these builds aren't, so on a Mac
// a new version is reported as 'available' and "installing" opens the download page instead.

const RELEASES_URL = 'https://github.com/Grovuss/Workbench/releases/latest';
const manualInstall = process.platform === 'darwin';

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** { state: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error', version?, percent?, message? } */
let status = { state: app.isPackaged ? 'idle' : 'unsupported' };
let updater = null;
let broadcast = () => {};

function setStatus(next) {
  status = next;
  broadcast({ type: 'update', ...status });
}

function start(send) {
  broadcast = send;
  if (!app.isPackaged) return;
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = !manualInstall;
  updater.autoInstallOnAppQuit = !manualInstall;
  updater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  updater.on('update-available', (info) =>
    setStatus(manualInstall ? { state: 'available', version: info.version } : { state: 'downloading', version: info.version, percent: 0 }),
  );
  updater.on('download-progress', (p) => setStatus({ ...status, state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-not-available', () => setStatus({ state: 'latest' }));
  updater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }));
  updater.on('error', (err) => setStatus({ state: 'error', message: err?.message ?? String(err) }));
  check();
  setInterval(check, CHECK_EVERY_MS).unref?.();
}

function check() {
  // A downloaded update stays ready; checking again would only download it twice.
  if (!updater || status.state === 'ready' || status.state === 'downloading' || status.state === 'available') return status;
  updater.checkForUpdates().catch(() => {});
  return status;
}

/** Restarts into the downloaded update, or on a Mac opens the page to download it. */
function install() {
  if (status.state === 'ready') updater.quitAndInstall(false, true);
  else if (status.state === 'available') shell.openExternal(RELEASES_URL);
}

module.exports = { start, check, install, status: () => status };
