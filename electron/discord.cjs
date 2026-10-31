const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DISCORD_CLIENT_ID } = require('./config.cjs');
const settings = require('./settings.cjs');
const { LOADER_NAMES } = require('./launcher/loaders.cjs');

// Discord Rich Presence over Discord's local IPC socket: "Playing Workbench", with the
// profile while a game runs and "In the launcher" otherwise. Does nothing without a
// Discord application id, and keeps trying quietly while Discord isn't running.

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;

/** profileId → { profile, startedAt } for games running now; the newest one is shown. */
const playing = new Map();
let socket = null;
let connecting = null;
const openedAt = Date.now();
// Discord may be started, or restarted, after Workbench.
const RETRY_MS = 20_000;
let retryTimer = null;

function socketPath(i) {
  if (process.platform === 'win32') return `\\\\.\\pipe\\discord-ipc-${i}`;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  return path.join(dir, `discord-ipc-${i}`);
}

function send(op, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  socket.write(Buffer.concat([header, body]));
}

function tryConnect(i) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(socketPath(i));
    s.once('connect', () => resolve(s));
    s.once('error', reject);
  });
}

/** Connects to the first Discord client found; null if Discord isn't open. */
async function connect() {
  if (socket) return socket;
  if (connecting) return connecting;
  connecting = (async () => {
    for (let i = 0; i < 10; i++) {
      try {
        const s = await tryConnect(i);
        s.on('error', () => {});
        s.on('close', () => {
          if (socket === s) socket = null;
        });
        // Discord ignores activity sent before it answers the handshake with READY.
        const ready = new Promise((resolve) => {
          s.once('data', resolve);
          s.once('close', resolve);
          setTimeout(resolve, 5000);
        });
        // Later replies aren't needed; reading keeps the pipe from filling up.
        s.on('data', () => {});
        socket = s;
        send(OP_HANDSHAKE, { v: 1, client_id: DISCORD_CLIENT_ID });
        await ready;
        if (socket !== s) continue;
        return s;
      } catch {}
    }
    return null;
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

function activityFor(current, showProfile) {
  const assets = { large_image: 'logo', large_text: 'Workbench' };
  if (!current) return { details: 'In the launcher', timestamps: { start: openedAt }, assets, instance: false };
  const { profile, startedAt } = current;
  const version = profile.loader === 'vanilla' ? `Minecraft ${profile.mcVersion}` : `${LOADER_NAMES[profile.loader]} ${profile.mcVersion}`;
  return {
    details: showProfile ? profile.name.slice(0, 128) : 'Playing Minecraft',
    state: version,
    timestamps: { start: startedAt },
    assets,
    instance: false,
  };
}

async function refresh() {
  if (!DISCORD_CLIENT_ID) return;
  const { discordPresence: enabled, discordShowProfile } = await settings.get();
  if (!enabled) {
    if (socket) send(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() });
    return;
  }
  if (!(await connect())) return;
  const current = [...playing.values()].at(-1);
  send(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activityFor(current, discordShowProfile) }, nonce: randomUUID() });
}

/** Shows "In the launcher" from startup, and reconnects whenever Discord comes back. */
function start() {
  if (!DISCORD_CLIENT_ID || retryTimer) return;
  refresh().catch(() => {});
  retryTimer = setInterval(() => {
    if (!socket) refresh().catch(() => {});
  }, RETRY_MS);
  retryTimer.unref?.();
}

function started(profile) {
  playing.set(profile.id, { profile, startedAt: Date.now() });
  refresh().catch(() => {});
}

function stopped(profileId) {
  playing.delete(profileId);
  refresh().catch(() => {});
}

/** After the setting changes. */
const settingsChanged = () => refresh().catch(() => {});

const configured = () => Boolean(DISCORD_CLIENT_ID);

module.exports = { start, started, stopped, settingsChanged, configured };
