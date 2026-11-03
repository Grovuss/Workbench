const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const paths = require('./paths.cjs');
const profiles = require('./profiles.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');
const { SUPPORT_URL, USER_AGENT } = require('./config.cjs');
const { LOADER_NAMES } = require('./launcher/loaders.cjs');

// Bug reports, suggestions and questions. They go to the support relay (support/ in the repo),
// which posts each one on Discord; replies there come back here. Each report's key, which lets
// only this computer read it, is kept with it in support.json.

const TYPES = new Set(['bug', 'suggestion', 'help']);
// Open reports are checked for replies this often while Workbench is open.
const CHECK_EVERY_MS = 5 * 60 * 1000;
// After this long without anything new, a report stops being checked in the background.
const QUIET_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const file = () => path.join(paths.root(), 'support.json');
const withLock = createLock();
let broadcast = () => {};

const configured = () => Boolean(SUPPORT_URL);
const load = () => readJson(file(), []);

const newer = (a, b) => b == null || (a != null && BigInt(a) > BigInt(b));

/** What the renderer sees: no keys, newest activity first, with how many replies are unread. */
function present(tickets) {
  return tickets
    .map(({ key: _key, cursor: _cursor, ...t }) => ({
      ...t,
      unread: t.messages.filter((m) => m.from === 'staff' && newer(m.id, t.seen)).length,
    }))
    .sort((a, b) => Date.parse(lastActivity(b)) - Date.parse(lastActivity(a)));
}

const lastActivity = (t) => t.messages.at(-1)?.at ?? t.createdAt;

async function list() {
  return present(await load());
}

async function relay(method, route, { key, body } = {}) {
  if (!configured()) throw new Error('Reporting isn’t set up in this build of Workbench.');
  let res;
  try {
    res = await fetch(SUPPORT_URL.replace(/\/$/, '') + route, {
      method,
      headers: {
        'User-Agent': USER_AGENT,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Couldn’t reach Workbench support. Check your internet connection.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error ?? `Workbench support said ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Details sent along ───────────────────────────────────────────────────────

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Takes out what a log shouldn't share: the home folder (it has your name in it), sign-in tokens, addresses. */
function scrub(text) {
  let out = text;
  const home = os.homedir();
  for (const form of new Set([home, home.replace(/\\/g, '/')])) {
    out = out.replace(new RegExp(escapeRegExp(form), 'gi'), '~');
  }
  let user = '';
  try {
    user = os.userInfo().username;
  } catch {}
  if (user.length >= 3) out = out.replace(new RegExp(`([\\\\/])${escapeRegExp(user)}(?=[\\\\/])`, 'gi'), '$1<user>');
  return out
    .replace(/(--accessToken\s+)\S+/g, '$1<hidden>')
    .replace(/token:[^:\s\]]+:/g, 'token:<hidden>:')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<hidden token>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    // Server addresses, as Java prints them ("/203.0.113.5:25565") or as the game does ("203.0.113.5, 25565").
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?=:\d|, \d)/g, (ip) => (ip.startsWith('127.') ? ip : '<address>'));
}

async function countMods(profileId) {
  const names = await fsp.readdir(path.join(profiles.gameDir(profileId), 'mods')).catch(() => []);
  return names.filter((n) => n.endsWith('.jar')).length;
}

/**
 * Exactly what a report sends besides what was typed, for showing before it goes:
 * { details: 'Workbench 0.7.0 · Windows 11…\nProfile: …', log: { name, text } | null }.
 */
async function attachments({ profileId, includeLog } = {}, system) {
  const lines = [`Workbench ${system.version} · ${system.os}`];
  let log = null;
  if (profileId) {
    const profile = await profiles.get(String(profileId));
    const loader = LOADER_NAMES[profile.loader] ?? profile.loader;
    const parts = [`${loader} ${profile.mcVersion}`];
    if (profile.loader !== 'vanilla') parts.push(`${await countMods(profile.id)} mods`);
    lines.push(`Profile: ${parts.join(' · ')}`);
    if (includeLog) {
      const text = await profiles.readLog(profile.id);
      if (text) log = { name: 'game-log.txt', text: scrub(text) };
    }
  }
  return { details: lines.join('\n'), log };
}

// ── Reports ──────────────────────────────────────────────────────────────────

async function create(input, system) {
  const type = String(input?.type);
  if (!TYPES.has(type)) throw new Error('Pick what kind of report this is.');
  const title = String(input?.title ?? '').trim().slice(0, 90);
  const text = String(input?.text ?? '').trim().slice(0, 1500);
  if (!title) throw new Error('Give it a title.');
  if (!text) throw new Error('Write a few words about it.');
  const contact = String(input?.contact ?? '').trim().slice(0, 100);
  const { details, log } = await attachments({ profileId: input?.profileId, includeLog: Boolean(input?.includeLog) }, system);

  const { id, key, createdAt } = await relay('POST', '/tickets', { body: { type, title, text, contact, details, log } });
  const ticket = { id, key, type, title, text, contact, details, logSent: Boolean(log), createdAt, closed: false, cursor: null, seen: null, messages: [] };
  return withLock(async () => {
    await writeJson(file(), [...(await load()), ticket]);
    return present([ticket])[0];
  });
}

async function send(id, text) {
  const message = String(text ?? '').trim();
  if (!message) throw new Error('Write a message first.');
  const ticket = (await load()).find((t) => t.id === id);
  if (!ticket) throw new Error('Report not found.');
  let sent;
  try {
    sent = await relay('POST', `/tickets/${id}/messages`, { key: ticket.key, body: { text: message.slice(0, 1500) } });
  } catch (err) {
    if (err.status === 409) await update(id, (t) => ({ ...t, closed: true }));
    throw err;
  }
  return update(id, (t) => ({
    ...t,
    messages: t.messages.some((m) => m.id === sent.id) ? t.messages : [...t.messages, sent],
  }));
}

/** Applies a change to one stored report and returns it as the renderer sees it. */
function update(id, change) {
  return withLock(async () => {
    const all = await load();
    const i = all.findIndex((t) => t.id === id);
    if (i < 0) throw new Error('Report not found.');
    all[i] = change(all[i]);
    await writeJson(file(), all);
    return present([all[i]])[0];
  });
}

/** Fetches new replies for one report. Resolves to how many new ones there were from Workbench. */
async function fetchReplies(ticket) {
  let cursor = ticket.cursor;
  let closed = ticket.closed;
  const fresh = [];
  for (let page = 0; page < 5; page++) {
    const data = await relay('GET', `/tickets/${ticket.id}${cursor ? `?after=${cursor}` : ''}`, { key: ticket.key });
    closed = data.closed;
    fresh.push(...data.messages);
    cursor = data.cursor ?? cursor;
    if (!data.more) break;
  }
  let added = 0;
  await update(ticket.id, (t) => {
    const known = new Set(t.messages.map((m) => m.id));
    const incoming = fresh.filter((m) => !known.has(m.id));
    added = incoming.filter((m) => m.from === 'staff').length;
    return { ...t, closed, cursor, messages: [...t.messages, ...incoming] };
  });
  return added;
}

/** Checks one report (or every open one) for replies; resolves to the reports. */
async function refresh(id) {
  const all = await load();
  const now = Date.now();
  const due = id
    ? all.filter((t) => t.id === id)
    : all.filter((t) => !t.closed && now - Date.parse(lastActivity(t)) < QUIET_AFTER_MS);
  let added = 0;
  for (const ticket of due) {
    try {
      added += await fetchReplies(ticket);
    } catch (err) {
      // A report deleted on Discord can't be read any more; stop checking it.
      if (err.status === 404) await update(ticket.id, (t) => ({ ...t, closed: true })).catch(() => {});
      else if (id) throw err;
    }
  }
  const tickets = await list();
  if (added) broadcast({ type: 'support-changed' });
  return tickets;
}

/** Marks a report's replies as read. */
function markRead(id) {
  return update(id, (t) => ({ ...t, seen: t.messages.at(-1)?.id ?? t.seen }));
}

/** Forgets a report on this computer; it stays on Discord. */
function remove(id) {
  return withLock(async () => {
    const all = await load();
    await writeJson(file(), all.filter((t) => t.id !== id));
  });
}

function start(send) {
  broadcast = send;
  if (!configured()) return;
  const check = () => refresh().catch(() => {});
  setTimeout(check, 15_000).unref?.();
  setInterval(check, CHECK_EVERY_MS).unref?.();
}

module.exports = { configured, list, attachments, create, send, refresh, markRead, remove, start, scrub };
