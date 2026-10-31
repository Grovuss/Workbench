const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DISCORD_CLIENT_ID } = require('./config.cjs');
const settings = require('./settings.cjs');
const { LOADER_NAMES } = require('./launcher/loaders.cjs');

// Discord Rich Presence over Discord's local IPC socket: "Playing Workbench · <profile>".
// Does nothing without a Discord application id, or when Discord isn't running.

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;

/** profileId → { profile, startedAt } for games running now; the newest one is shown. */
const playing = new Map();
let socket = null;
let connecting = null;

function socketPath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
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
        // Replies aren't needed; reading keeps the pipe from filling up.
        s.on('data', () => {});
        socket = s;
        send(OP_HANDSHAKE, { v: 1, client_id: DISCORD_CLIENT_ID });
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

function activityFor({ profile, startedAt }) {
  const loader = profile.loader === 'vanilla' ? 'Minecraft' : `${LOADER_NAMES[profile.loader]} ${profile.mcVersion}`;
  return {
    details: profile.name.slice(0, 128),
    state: profile.loader === 'vanilla' ? `Minecraft ${profile.mcVersion}` : loader,
    timestamps: { start: startedAt },
    assets: { large_image: 'logo', large_text: 'Workbench' },
    instance: false,
  };
}

async function refresh() {
  if (!DISCORD_CLIENT_ID) return;
  const enabled = (await settings.get()).discordPresence;
  const current = [...playing.values()].at(-1);
  if (!current || !enabled) {
    if (socket) send(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() });
    return;
  }
  if (!(await connect())) return;
  send(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activityFor(current) }, nonce: randomUUID() });
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

module.exports = { started, stopped, settingsChanged, configured };
