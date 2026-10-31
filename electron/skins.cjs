const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { nativeImage } = require('electron');
const auth = require('./auth.cjs');
const paths = require('./paths.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');

// The signed-in account's skin and cape (through Mojang's profile API), plus a local
// library of skins to switch between. Library skins live in <userData>/skins/<id>.png.

const PROFILE_API = 'https://api.minecraftservices.com/minecraft/profile';
const SKIN_ID = /^[0-9a-f-]{36}$/;

const libraryDir = () => path.join(paths.root(), 'skins');
const libraryFile = () => path.join(libraryDir(), 'library.json');
const skinFile = (id) => path.join(libraryDir(), `${id}.png`);
const withLock = createLock();

async function session() {
  const account = await auth.getLaunchAccount();
  if (account.offline) throw new Error('Sign in with a Microsoft account to change your skin.');
  return account;
}

async function call(account, pathname, { method = 'GET', json, form } = {}) {
  const res = await fetch(PROFILE_API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(json) : form,
  });
  if (res.status === 401) throw new Error('Your session has expired. Sign in again.');
  if (res.status === 429) throw new Error('Mojang limits how often skins can change. Wait a minute and try again.');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.errorMessage || `Mojang’s skin service returned an error (${res.status}).`);
  }
  return res.json().catch(() => null);
}

const https = (url) => url?.replace(/^http:/, 'https:') ?? null;

/** Mojang profile → { account, skin, capes } for the renderer; keeps the sidebar head in sync. */
async function toState(account, profile) {
  const active = profile?.skins?.find((s) => s.state === 'ACTIVE');
  const skin = active ? { url: https(active.url), variant: active.variant === 'SLIM' ? 'slim' : 'classic' } : null;
  await auth.setSkinUrl(account.uuid, active?.url ?? null);
  return {
    account: { id: account.uuid, name: account.name },
    skin,
    capes: (profile?.capes ?? []).map((c) => ({ id: c.id, alias: c.alias ?? 'Cape', url: https(c.url), active: c.state === 'ACTIVE' })),
  };
}

async function state() {
  const account = await session();
  return toState(account, await call(account, ''));
}

/** Checks a PNG is a Minecraft skin; returns its guessed arm style. */
function inspect(buf) {
  const image = nativeImage.createFromBuffer(buf);
  const { width, height } = image.getSize();
  if (image.isEmpty() || width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error('That isn’t a Minecraft skin. Skins are 64×64 (or 64×32) PNG images.');
  }
  if (height === 32) return 'classic';
  // Slim skins have 3-pixel arms, so this pixel of the right arm is see-through.
  const bitmap = image.toBitmap();
  return bitmap[(20 * 64 + 54) * 4 + 3] === 0 ? 'slim' : 'classic';
}

async function upload(buf, variant) {
  const account = await session();
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  return toState(account, await call(account, '/skins', { method: 'POST', form }));
}

async function reset() {
  const account = await session();
  return toState(account, await call(account, '/skins/active', { method: 'DELETE' }));
}

async function setCape(capeId) {
  const account = await session();
  const profile = capeId
    ? await call(account, '/capes/active', { method: 'PUT', json: { capeId: String(capeId) } })
    : await call(account, '/capes/active', { method: 'DELETE' });
  return toState(account, profile);
}

// ---------- Library ----------

const loadLibrary = async () => (await readJson(libraryFile(), { skins: [] })).skins;
const saveLibrary = (skins) => writeJson(libraryFile(), { skins });

const listLibrary = async () => (await loadLibrary()).sort((a, b) => b.addedAt.localeCompare(a.addedAt));

function addToLibrary(buf, name) {
  const variant = inspect(buf);
  return withLock(async () => {
    const skins = await loadLibrary();
    const entry = {
      id: randomUUID(),
      name: String(name ?? '').trim().slice(0, 40) || 'Skin',
      variant,
      addedAt: new Date().toISOString(),
    };
    await fsp.mkdir(libraryDir(), { recursive: true });
    await fsp.writeFile(skinFile(entry.id), buf);
    skins.push(entry);
    await saveLibrary(skins);
    return listLibrary();
  });
}

async function addFiles(filePaths) {
  let result = await listLibrary();
  for (const file of filePaths) {
    const { size } = await fsp.stat(file);
    if (size > 1024 * 1024) throw new Error(`${path.basename(file)} is too large to be a skin.`);
    result = await addToLibrary(await fsp.readFile(file), path.basename(file).replace(/\.png$/i, ''));
  }
  return result;
}

/** Saves the skin the account is wearing, so it isn't lost when switching. */
async function saveCurrent() {
  const { skin, account } = await state();
  if (!skin) throw new Error('You’re wearing a default skin.');
  const res = await fetch(skin.url);
  if (!res.ok) throw new Error('Couldn’t download your current skin.');
  return addToLibrary(Buffer.from(await res.arrayBuffer()), `${account.name}’s skin`);
}

const libraryEntry = async (id) => {
  const entry = (await loadLibrary()).find((s) => s.id === id);
  if (!entry) throw new Error('Skin not found.');
  return entry;
};

async function wear(id) {
  const entry = await libraryEntry(id);
  return upload(await fsp.readFile(skinFile(entry.id)), entry.variant);
}

function updateEntry(id, patch) {
  return withLock(async () => {
    const skins = await loadLibrary();
    const entry = skins.find((s) => s.id === id);
    if (!entry) throw new Error('Skin not found.');
    if (patch.variant !== undefined) entry.variant = patch.variant === 'slim' ? 'slim' : 'classic';
    if (patch.name !== undefined) entry.name = String(patch.name).trim().slice(0, 40) || entry.name;
    await saveLibrary(skins);
    return listLibrary();
  });
}

function removeFromLibrary(id) {
  return withLock(async () => {
    const skins = await loadLibrary();
    if (!skins.some((s) => s.id === id)) throw new Error('Skin not found.');
    await fsp.rm(skinFile(id), { force: true });
    await saveLibrary(skins.filter((s) => s.id !== id));
    return listLibrary();
  });
}

/** PNG bytes of a library skin, for the workbench:// protocol. */
async function read(id) {
  if (!SKIN_ID.test(id)) return null;
  return fsp.readFile(skinFile(id)).catch(() => null);
}

module.exports = {
  state,
  reset,
  setCape,
  wear,
  listLibrary,
  addFiles,
  saveCurrent,
  updateEntry,
  removeFromLibrary,
  read,
};
