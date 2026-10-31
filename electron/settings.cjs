const os = require('node:os');
const path = require('node:path');
const paths = require('./paths.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');

const file = () => path.join(paths.root(), 'settings.json');
const withLock = createLock();

const totalMemoryMb = () => Math.floor(os.totalmem() / 1024 / 1024);

const LAUNCHER_ON_LAUNCH = ['keep', 'minimize', 'hide'];
const TOGGLES = ['welcomed', 'autoBackup', 'discordPresence', 'discordShowProfile', 'shareOptions', 'fullscreen'];
const TEXTS = ['jvmArgs', 'preLaunchCommand', 'postExitCommand'];

function defaults() {
  // A quarter of system RAM, between 1 GB and 4 GB, in 512 MB steps.
  const quarter = Math.floor(totalMemoryMb() / 4 / 512) * 512;
  return {
    // Set once the first-run welcome has been seen (or skipped).
    welcomed: false,
    memoryMb: Math.min(4096, Math.max(1024, quarter)),
    // Added before each profile's own Java arguments.
    jvmArgs: '',
    // The game window for profiles without their own size; null is the game's default.
    resolution: null,
    fullscreen: false,
    // What the launcher window does while the game runs.
    onLaunch: 'keep',
    // Shell commands run in the profile's folder before the game starts and after it closes.
    preLaunchCommand: '',
    postExitCommand: '',
    // Back up worlds after playing, when they changed.
    autoBackup: true,
    // Automatic backups kept per world.
    backupsToKeep: 5,
    // Show what's being played on Discord.
    discordPresence: true,
    // Off: Discord says "Minecraft 26.2" without the profile's name.
    discordShowProfile: true,
    // Copy game settings (keybinds, video, sound) into new profiles from the most recently played one.
    shareOptions: true,
    // Files downloaded at once when installing a version.
    downloadThreads: 16,
  };
}

async function get() {
  return { ...defaults(), ...(await readJson(file(), {})) };
}

function wholeNumber(value, min, max, what) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${what}.`);
  return n;
}

function set(patch) {
  return withLock(async () => {
    const next = await get();
    if (patch.memoryMb !== undefined) next.memoryMb = wholeNumber(patch.memoryMb, 512, totalMemoryMb(), 'memory amount');
    if (patch.backupsToKeep !== undefined) next.backupsToKeep = wholeNumber(patch.backupsToKeep, 1, 50, 'number of backups');
    if (patch.downloadThreads !== undefined) next.downloadThreads = wholeNumber(patch.downloadThreads, 1, 64, 'number of downloads');
    if (patch.resolution !== undefined) {
      next.resolution =
        patch.resolution === null
          ? null
          : {
              width: wholeNumber(patch.resolution.width, 320, 7680, 'window width'),
              height: wholeNumber(patch.resolution.height, 240, 4320, 'window height'),
            };
    }
    if (patch.onLaunch !== undefined) {
      if (!LAUNCHER_ON_LAUNCH.includes(patch.onLaunch)) throw new Error('Invalid launcher behaviour.');
      next.onLaunch = patch.onLaunch;
    }
    for (const key of TOGGLES) {
      if (patch[key] !== undefined) next[key] = Boolean(patch[key]);
    }
    for (const key of TEXTS) {
      if (patch[key] !== undefined) next[key] = String(patch[key]).slice(0, 2000);
    }
    await writeJson(file(), next);
    return next;
  });
}

/** Back to the defaults; memory included. */
function reset() {
  return withLock(async () => {
    await writeJson(file(), {});
    return get();
  });
}

module.exports = { get, set, reset, totalMemoryMb };
