const { spawn } = require('node:child_process');
const { BrowserWindow } = require('electron');
const auth = require('./auth.cjs');
const diagnose = require('./diagnose.cjs');
const discord = require('./discord.cjs');
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

// The launch hooks get the profile through these, e.g. %WORKBENCH_GAME_DIR% or $WORKBENCH_GAME_DIR.
function hookEnv(profile, gameDir) {
  return {
    ...process.env,
    WORKBENCH_PROFILE_ID: profile.id,
    WORKBENCH_PROFILE_NAME: profile.name,
    WORKBENCH_GAME_DIR: gameDir,
    WORKBENCH_MC_VERSION: profile.mcVersion,
    WORKBENCH_LOADER: profile.loader,
  };
}

/** Runs the before-launch command and waits for it; a failure stops the launch. */
function runPreLaunch(command, profile, gameDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd: gameDir, env: hookEnv(profile, gameDir), stdio: 'ignore', windowsHide: true });
    child.once('error', (err) => reject(new Error(`The before-launch command couldn't run: ${err.message}`)));
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`The before-launch command failed (exit code ${code}), so the game wasn't started.`))));
  });
}

/** Starts the after-close command and leaves it running on its own. */
function runPostExit(command, profile, gameDir) {
  try {
    spawn(command, { shell: true, cwd: gameDir, env: hookEnv(profile, gameDir), stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch (err) {
    console.error('[hook]', err);
  }
}

/** Minimizes or hides the launcher while the game runs, per the setting. */
function stepAside(onLaunch) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (onLaunch === 'minimize') win.minimize();
    if (onLaunch === 'hide') win.hide();
  }
}

function comeBack(onLaunch) {
  if (onLaunch === 'keep' || [...sessions.values()].some((s) => s.state === 'running')) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (onLaunch === 'hide') win.show();
    if (win.isMinimized()) win.restore();
  }
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
    const gameDir = profiles.gameDir(profileId);
    if (global.preLaunchCommand.trim()) await runPreLaunch(global.preLaunchCommand, profile, gameDir);
    const { child, logFile } = await launchGame({
      profile,
      gameDir,
      account,
      memoryMb: profile.settings.memoryMb ?? global.memoryMb,
      // The profile's own arguments come last, so they win.
      jvmArgs: [global.jvmArgs, profile.settings.jvmArgs].filter((a) => a.trim()).join(' '),
      resolution: profile.settings.resolution ?? global.resolution,
      fullscreen: global.fullscreen,
      downloadThreads: global.downloadThreads,
      quickPlay,
      onProgress,
    });

    session.state = 'running';
    session.child = child;
    setState(profileId, 'running');
    stepAside(global.onLaunch);
    discord.started(profile);
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
      discord.stopped(profileId);
      comeBack(global.onLaunch);
      if (global.postExitCommand.trim()) runPostExit(global.postExitCommand, profile, gameDir);
      // Worlds played this session get a backup, if they changed.
      require('./worlds.cjs')
        .backupChanged(profileId)
        .then((count) => count && broadcast({ type: 'worlds-backed-up', profileId, count }))
        .catch((err) => console.error('[backup]', err));
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
