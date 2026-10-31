const net = require('node:net');
const dns = require('node:dns/promises');

// Server List Ping (Java Edition 1.7+): the same status the multiplayer screen shows.
// https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping

const DEFAULT_PORT = 25565;
const TIMEOUT_MS = 5000;
const MAX_RESPONSE = 1024 * 1024;

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return Buffer.from(out);
}

/** Reads a VarInt at `offset`; returns null if the buffer ends first. */
function readVarint(buf, offset) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const byte = buf[offset + i];
    value |= (byte & 0x7f) << (7 * i);
    if (!(byte & 0x80)) return { value, size: i + 1 };
  }
  throw new Error('Bad response from server.');
}

const packet = (...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([varint(body.length), body]);
};

const mcString = (s) => {
  const bytes = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(bytes.length), bytes]);
};

/** "host", "host:port" or "[v6]:port" → { host, port, explicitPort }. */
function parseAddress(address) {
  const v6 = /^\[(.+)\](?::(\d+))?$/.exec(address);
  if (v6) return { host: v6[1], port: Number(v6[2] ?? DEFAULT_PORT), explicitPort: Boolean(v6[2]) };
  const [host, port] = address.split(':');
  return { host, port: Number(port ?? DEFAULT_PORT), explicitPort: port !== undefined };
}

/** Servers without a port may point elsewhere through a _minecraft._tcp SRV record, like the game does. */
async function resolve(address) {
  const { host, port, explicitPort } = parseAddress(address);
  if (!host || !(port > 0 && port < 65536)) throw new Error('Invalid server address.');
  if (!explicitPort && !net.isIP(host)) {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`).catch(() => []);
    if (records.length) return { host: records[0].name, port: records[0].port, handshakeHost: host };
  }
  return { host, port, handshakeHost: host };
}

/** Flattens a chat component (or legacy string) to plain text without § formatting codes. */
function chatText(component) {
  if (component == null) return '';
  if (typeof component === 'string') return component.replace(/§./g, '');
  const own = typeof component.text === 'string' ? component.text : '';
  return (own + (component.extra ?? []).map(chatText).join('')).replace(/§./g, '');
}

async function ping(address) {
  const { host, port, handshakeHost } = await resolve(String(address ?? '').trim());
  const started = Date.now();

  const raw = await new Promise((resolvePing, reject) => {
    const socket = net.connect({ host, port });
    let data = Buffer.alloc(0);
    const fail = (message) => {
      socket.destroy();
      reject(new Error(message));
    };
    socket.setTimeout(TIMEOUT_MS, () => fail('The server didn’t respond.'));
    socket.once('error', (err) =>
      fail(err.code === 'ENOTFOUND' ? 'Server not found.' : err.code === 'ECONNREFUSED' ? 'The server refused the connection.' : 'Couldn’t reach the server.'),
    );
    socket.once('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      // Handshake (protocol -1 = "any", next state 1 = status), then a status request.
      socket.write(packet(varint(0x00), varint(-1), mcString(handshakeHost), portBuf, varint(1)));
      socket.write(packet(varint(0x00)));
    });
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > MAX_RESPONSE) return fail('Bad response from server.');
      try {
        const length = readVarint(data, 0);
        if (!length || data.length < length.size + length.value) return;
        const id = readVarint(data, length.size);
        const strLen = readVarint(data, length.size + id.size);
        const start = length.size + id.size + strLen.size;
        socket.end();
        resolvePing(data.toString('utf8', start, start + strLen.value));
      } catch (err) {
        fail(err.message);
      }
    });
  });

  let status;
  try {
    status = JSON.parse(raw);
  } catch {
    throw new Error('Bad response from server.');
  }
  return {
    latencyMs: Date.now() - started,
    version: chatText(status.version?.name) || null,
    players: status.players ? { online: status.players.online ?? 0, max: status.players.max ?? 0 } : null,
    motd: chatText(status.description).trim(),
    icon: typeof status.favicon === 'string' && status.favicon.startsWith('data:image/png;base64,') ? status.favicon : null,
  };
}

module.exports = { ping, parseAddress };
