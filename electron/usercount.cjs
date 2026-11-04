const crypto = require('node:crypto');
const path = require('node:path');
const { app } = require('electron');
const paths = require('./paths.cjs');
const settings = require('./settings.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');
const { SUPPORT_URL, USER_AGENT } = require('./config.cjs');

// Counts this copy of Workbench, once, toward "people using Workbench" on the website.
// All it sends is a random id made here, so the same copy isn't counted twice; turning the
// setting off sends the id again to take it back off. Only installed builds count.

const file = () => path.join(paths.root(), 'install.json');
const withLock = createLock();

function sync() {
  return withLock(async () => {
    if (!SUPPORT_URL || !app.isPackaged) return;
    const { countMe } = await settings.get();
    const state = await readJson(file(), {});
    // Nothing to do: already where it should be, or never counted and not wanted.
    if (Boolean(state.counted) === countMe) return;
    const id = state.id ?? crypto.randomUUID();
    const res = await fetch(`${SUPPORT_URL.replace(/\/$/, '')}/installs${countMe ? '' : '/remove'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(15_000),
    });
    // Tried again next time Workbench starts.
    if (res.ok) await writeJson(file(), { id, counted: countMe });
  });
}

const quietly = () => sync().catch(() => {});

function start() {
  setTimeout(quietly, 20_000).unref?.();
}

module.exports = { start, settingsChanged: quietly };
