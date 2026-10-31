const { BrowserWindow } = require('electron');
const auth = require('./auth.cjs');
const diagnose = require('./diagnose.cjs');
const profiles = require('./profiles.cjs');
const settings = require('./settings.cjs');
const { launchGame } = require('./launcher/launch.cjs');

const PLAYTIME_CHECKPOINT_MS = 60_000;

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

async function launch(profileId, quickPlay) {
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

  const startedAt = Date.now();
  try {
    const account = await auth.getLaunchAccount();
    const profile = await profiles.get(profileId);
    const global = await settings.get();
    const { child, logFile } = await launchGame({
      profile,
      gameDir: profiles.gameDir(profileId),
      account,
      memoryMb: profile.settings.memoryMb ?? global.memoryMb,
      jvmArgs: profile.settings.jvmArgs,
      resolution: profile.settings.resolution,
      quickPlay,
      onProgress,
    });

    session.state = 'running';
    session.child = child;
    setState(profileId, 'running');
    profiles
      .update(profileId, { lastPlayedAt: new Date().toISOString() })
      .then(() => broadcast({ type: 'profiles-changed' }))
      .catch(() => {});

    // Playtime is saved every minute too, so closing the launcher mid-game loses at most a minute.
    let counted = Date.now();
    const countPlaytime = () => {
      const now = Date.now();
      const ms = now - counted;
      counted = now;
      return profiles.addPlaytime(profileId, ms).catch(() => {});
    };
    const checkpoint = setInterval(countPlaytime, PLAYTIME_CHECKPOINT_MS);

    let ended = false;
    const end = (message) => {
      if (ended) return;
      ended = true;
      clearInterval(checkpoint);
      countPlaytime().then(() => broadcast({ type: 'profiles-changed' }));
      sessions.delete(profileId);
      setState(profileId, 'idle');
      if (message && !session.stopping) broadcast({ type: 'error', profileId, message });
    };
    child.once('error', (err) => end(`Couldn't start Minecraft: ${err.message}`));
    child.once('exit', (code) => {
      if (ended) return; // it never started
      end(null);
      if (session.stopping) return;
      // Explain crashes (and loader errors shown in game, which exit normally) instead of just reporting the exit code.
      diagnose
        .analyzeCrash(profileId, startedAt, code)
        .then((report) => report && broadcast({ type: 'crash', profileId, report }))
        .catch(() => code && broadcast({ type: 'error', profileId, message: `Minecraft exited with code ${code}. Details are in ${logFile}` }));
    });
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
