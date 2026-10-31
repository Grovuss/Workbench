const { BrowserWindow } = require('electron');
const auth = require('./auth.cjs');
const profiles = require('./profiles.cjs');
const settings = require('./settings.cjs');
const { launchGame } = require('./launcher/launch.cjs');

/** profileId → { state: 'installing' | 'running', child?, stopping? } */
const sessions = new Map();

function broadcast(event) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('game:event', event);
}

function setState(profileId, state) {
  broadcast({ type: 'state', profileId, state });
}

function status() {
  return Object.fromEntries([...sessions].map(([id, s]) => [id, s.state]));
}

const isActive = (profileId) => sessions.has(profileId);

async function launch(profileId) {
  if (sessions.has(profileId)) return;
  const session = { state: 'installing' };
  sessions.set(profileId, session);
  setState(profileId, 'installing');

  // Asset downloads report thousands of steps; cap IPC traffic to ~10 updates a second.
  let lastSent = 0;
  const onProgress = (p) => {
    const now = Date.now();
    if (p.done !== 0 && p.done !== p.total && now - lastSent < 100) return;
    lastSent = now;
    broadcast({ type: 'progress', profileId, ...p });
  };

  try {
    const account = await auth.getLaunchAccount();
    const profile = await profiles.get(profileId);
    const { memoryMb } = await settings.get();
    const { child, logFile } = await launchGame({
      profile,
      gameDir: profiles.gameDir(profileId),
      account,
      memoryMb,
      onProgress,
    });

    session.state = 'running';
    session.child = child;
    setState(profileId, 'running');
    profiles
      .update(profileId, { lastPlayedAt: new Date().toISOString() })
      .then(() => broadcast({ type: 'profiles-changed' }))
      .catch(() => {});

    let ended = false;
    const end = (message) => {
      if (ended) return;
      ended = true;
      sessions.delete(profileId);
      setState(profileId, 'idle');
      if (message && !session.stopping) broadcast({ type: 'error', profileId, message });
    };
    child.once('error', (err) => end(`Couldn't start Minecraft: ${err.message}`));
    child.once('exit', (code) =>
      end(code ? `Minecraft exited with code ${code}. Details are in ${logFile}` : null),
    );
  } catch (err) {
    sessions.delete(profileId);
    setState(profileId, 'idle');
    broadcast({ type: 'error', profileId, message: err.message });
  }
}

function stop(profileId) {
  const session = sessions.get(profileId);
  if (!session?.child) return;
  session.stopping = true;
  session.child.kill();
}

module.exports = { launch, stop, status, isActive, broadcast };
