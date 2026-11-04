// Workbench support relay: a Cloudflare Worker between the app and a Discord forum.
//
// Every report from the app becomes a post in the forum channel. Replying in the post on
// Discord sends the reply back to the app, which checks for replies now and then. Nothing has
// to stay running: the Worker only talks to Discord's web API when the app asks it something.
//
// Secrets (set with `npx wrangler secret put <NAME>`, never written to a file):
//   DISCORD_BOT_TOKEN   the bot's token
//   FORUM_CHANNEL_ID    the forum channel reports go to
//   STAFF_IDS           Discord user ids whose replies reach the app, separated by commas
//   TICKET_SECRET       any long random string; signs the keys that let the app read its own reports
//
// Replies starting with "//" stay on Discord, for notes to yourself.

const API = 'https://discord.com/api/v10';
const TYPES = { bug: 'Bug', suggestion: 'Suggestion', help: 'Help' };
const LIMITS = { title: 90, text: 1500, contact: 100, details: 400, log: 4 * 1024 * 1024 };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong on our side. Try again in a bit.' }, 500);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = request.method;

  if (parts.length === 0 && method === 'GET') return json({ ok: true });
  if (parts[0] === 'stats' && parts.length === 1 && method === 'GET') return stats(env);
  if (parts[0] === 'installs' && method === 'POST' && parts.length <= 2) {
    await limit(env.CREATE_LIMITER, request, 'Too many requests. Wait a minute.');
    return json(await count(env, await body(request), parts[1] === 'remove'));
  }
  if (parts[0] !== 'tickets') throw new HttpError(404, 'Not found.');

  if (parts.length === 1 && method === 'POST') {
    await limit(env.CREATE_LIMITER, request, 'You sent a few reports just now. Wait a minute and try again.');
    return json(await createTicket(env, await body(request)));
  }

  const id = parts[1];
  if (!/^\d{1,20}$/.test(id ?? '')) throw new HttpError(404, 'Not found.');
  await checkKey(env, id, request);

  if (parts.length === 2 && method === 'GET') {
    await limit(env.READ_LIMITER, request, 'Checking too often. Wait a minute.');
    return json(await readTicket(env, id, url.searchParams.get('after')));
  }
  if (parts.length === 3 && parts[2] === 'messages' && method === 'POST') {
    await limit(env.MESSAGE_LIMITER, request, 'You sent a lot of messages just now. Wait a minute and try again.');
    return json(await reply(env, id, await body(request)));
  }
  throw new HttpError(404, 'Not found.');
}

// ── Reports ──────────────────────────────────────────────────────────────────

async function createTicket(env, input) {
  const type = TYPES[input.type];
  if (!type) throw new HttpError(400, 'Pick what kind of report this is.');
  const title = clean(input.title, LIMITS.title);
  const text = clean(input.text, LIMITS.text);
  if (!title) throw new HttpError(400, 'Give it a title.');
  if (!text) throw new HttpError(400, 'Write a few words about it.');
  const contact = clean(input.contact, LIMITS.contact);
  const details = clean(input.details, LIMITS.details);

  const lines = [text, ''];
  if (details) lines.push(...details.split('\n').map((line) => `-# ${line}`));
  if (contact) lines.push(`-# Contact: ${contact}`);
  const message = { content: lines.join('\n').trim(), allowed_mentions: { parse: [] } };

  const files = [];
  if (input.log && typeof input.log.text === 'string' && input.log.text.length) {
    const name = String(input.log.name || 'log.txt').replace(/[^\w.-]/g, '_').slice(0, 60);
    files.push({ name, text: input.log.text.slice(-LIMITS.log) });
    message.attachments = [{ id: 0, filename: name }];
  }

  const tag = await tagFor(env, type);
  const thread = await discord(env, 'POST', `/channels/${env.FORUM_CHANNEL_ID}/threads`, {
    name: `${type}: ${title}`.slice(0, 100),
    applied_tags: tag ? [tag] : [],
    message,
  }, files);

  // Following the post means Discord tells the staff about every reply from the app.
  for (const staff of staffIds(env)) {
    await discord(env, 'PUT', `/channels/${thread.id}/thread-members/${staff}`).catch(() => {});
  }
  return { id: thread.id, key: await keyFor(env, thread.id), createdAt: new Date().toISOString() };
}

/** New replies after `after` (a message id), plus whether the report has been closed. */
async function readTicket(env, id, after) {
  const thread = await discord(env, 'GET', `/channels/${id}`);
  const closed = Boolean(thread.thread_metadata?.locked);
  const since = /^\d{1,20}$/.test(after ?? '') ? after : id;
  const raw = await discord(env, 'GET', `/channels/${id}/messages?limit=100&after=${since}`);
  raw.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

  const bot = await botId(env);
  const staff = staffIds(env);
  const messages = [];
  for (const m of raw) {
    // Ordinary messages and replies only; not pins, joins and the like.
    if (m.type !== 0 && m.type !== 19) continue;
    let from;
    if (m.author.id === bot) from = 'you';
    else if (staff.includes(m.author.id) && !m.content.startsWith('//')) from = 'staff';
    else continue;
    messages.push({
      id: m.id,
      from,
      name: from === 'staff' ? m.author.global_name || m.author.username : null,
      text: m.content,
      at: m.timestamp,
      attachments: (m.attachments ?? []).map((a) => ({ name: a.filename, url: a.url })),
    });
  }
  // Where to continue from next time, past messages that were skipped too.
  const cursor = raw.length ? raw[raw.length - 1].id : (after ?? null);
  return { closed, messages, cursor, more: raw.length === 100 };
}

async function reply(env, id, input) {
  const text = clean(input.text, LIMITS.text);
  if (!text) throw new HttpError(400, 'Write a message first.');
  const thread = await discord(env, 'GET', `/channels/${id}`);
  if (thread.thread_metadata?.locked) throw new HttpError(409, 'This conversation was closed. Start a new one if you still need help.');
  // Quiet posts get archived by Discord; bring this one back.
  if (thread.thread_metadata?.archived) await discord(env, 'PATCH', `/channels/${id}`, { archived: false }).catch(() => {});
  const m = await discord(env, 'POST', `/channels/${id}/messages`, { content: text, allowed_mentions: { parse: [] } });
  return { id: m.id, from: 'you', name: null, text: m.content, at: m.timestamp, attachments: [] };
}

// ── People using Workbench ───────────────────────────────────────────────────
// Each copy of the app sends a random id once (and again to take itself off). Nothing else is kept.
// The website shows the total, never less than USER_BASE: the people using it before counting began
// are counted once they update, so they aren't counted twice.

const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function count(env, input, remove) {
  const id = String(input.id ?? '');
  if (!INSTALL_ID.test(id)) throw new HttpError(400, 'Bad request.');
  const key = `install:${id}`;
  const known = (await env.USERS.get(key)) !== null;
  if (known === remove) {
    const total = Number((await env.USERS.get('count')) ?? 0);
    const next = Math.max(0, total + (remove ? -1 : 1));
    await env.USERS.put('count', String(next));
    if (remove) await env.USERS.delete(key);
    else await env.USERS.put(key, '1');
  }
  return { ok: true };
}

async function stats(env) {
  const counted = Number((await env.USERS.get('count')) ?? 0);
  const users = Math.max(Number(env.USER_BASE ?? 0), counted);
  return new Response(JSON.stringify({ users }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // For the website.
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

// ── Keys ─────────────────────────────────────────────────────────────────────
// A report's key is a signature of its id, so the Worker needs no storage to check one.

async function keyFor(env, id) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TICKET_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`ticket:${id}`)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function checkKey(env, id, request) {
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const expected = await keyFor(env, id);
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b)) throw new HttpError(404, 'Not found.');
}

// ── Discord ──────────────────────────────────────────────────────────────────

let cachedBotId = null;
let cachedTags = null;

async function botId(env) {
  cachedBotId ??= (await discord(env, 'GET', '/users/@me')).id;
  return cachedBotId;
}

async function tagFor(env, name) {
  cachedTags ??= (await discord(env, 'GET', `/channels/${env.FORUM_CHANNEL_ID}`)).available_tags ?? [];
  return cachedTags.find((t) => t.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

const staffIds = (env) => String(env.STAFF_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function discord(env, method, path, payload, files = [], retried = false) {
  const headers = {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    'User-Agent': 'DiscordBot (https://github.com/Grovuss/Workbench, 1.0)',
  };
  let requestBody;
  if (files.length) {
    requestBody = new FormData();
    requestBody.append('payload_json', JSON.stringify(payload));
    files.forEach((f, i) => requestBody.append(`files[${i}]`, new Blob([f.text], { type: 'text/plain' }), f.name));
  } else if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(payload);
  }

  const res = await fetch(API + path, { method, headers, body: requestBody });
  if (res.status === 429 && !retried) {
    const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 1);
    if (wait <= 5) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      return discord(env, method, path, payload, files, true);
    }
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`Discord ${method} ${path} → ${res.status}`, JSON.stringify(data));
    if (res.status === 404 || data?.code === 10003) throw new HttpError(404, 'Not found.');
    throw new HttpError(502, 'Couldn’t reach Discord. Try again in a bit.');
  }
  return data;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function limit(limiter, request, message) {
  if (!limiter) return;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await limiter.limit({ key: ip });
  if (!success) throw new HttpError(429, message);
}

async function body(request) {
  const text = await request.text();
  if (text.length > LIMITS.log + 64 * 1024) throw new HttpError(413, 'That’s too much to send.');
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object') return value;
  } catch {}
  throw new HttpError(400, 'Bad request.');
}

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
