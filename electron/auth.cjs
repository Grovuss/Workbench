const crypto = require('node:crypto');
const path = require('node:path');
const { app, BrowserWindow, safeStorage } = require('electron');
const paths = require('./paths.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');
const { MSA_CLIENT_ID, DEV_OFFLINE_NAME } = require('./config.cjs');

const DEV_OFFLINE_ID = 'dev-offline';
const devOffline = () =>
  !app.isPackaged && DEV_OFFLINE_NAME ? { id: DEV_OFFLINE_ID, name: DEV_OFFLINE_NAME, skinUrl: null, offline: true } : null;

// Same UUID scheme vanilla servers use for offline players (v3 UUID of "OfflinePlayer:<name>").
function offlineUuid(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return hash.toString('hex');
}

const AUTHORIZE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPE = 'XboxLive.signin offline_access';

const XSTS_ERRORS = {
  2148916227: 'This Microsoft account is banned from Xbox.',
  2148916233: "This Microsoft account doesn't have an Xbox profile yet. Sign in once at minecraft.net, then try again.",
  2148916235: "Xbox Live isn't available in your region.",
  2148916236: 'This account needs adult verification on the Xbox website.',
  2148916237: 'This account needs adult verification on the Xbox website.',
  2148916238: 'This is a child account. An adult needs to add it to a Microsoft family first.',
};

const file = () => path.join(paths.root(), 'accounts.json');
const withLock = createLock();

// ---------- HTTP ----------

async function request(url, { form, json, headers = {} } = {}) {
  const init = { method: form || json ? 'POST' : 'GET', headers: { Accept: 'application/json', ...headers } };
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
  } else if (json) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, body };
}

// ---------- Microsoft OAuth (authorization code + PKCE in a popup) ----------

function promptForCode(parent) {
  return new Promise((resolve, reject) => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('base64url');

    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: MSA_CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    }).toString();

    const win = new BrowserWindow({
      parent: parent ?? undefined,
      modal: Boolean(parent),
      width: 500,
      height: 650,
      title: 'Sign in with Microsoft',
      autoHideMenuBar: true,
      // In-memory session: each sign-in starts clean, so switching accounts works.
      webPreferences: { partition: `msa-${Date.now()}` },
    });

    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (!win.isDestroyed()) win.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    const intercept = (target) => {
      if (!target?.startsWith(REDIRECT_URI)) return false;
      const params = new URL(target).searchParams;
      if (params.get('error')) finish(new Error(params.get('error_description') || params.get('error')));
      else if (params.get('state') !== state) finish(new Error('Sign-in failed: state mismatch.'));
      else finish(null, { code: params.get('code'), verifier });
      return true;
    };

    win.webContents.on('will-redirect', (e, u) => {
      if (intercept(e.url ?? u)) e.preventDefault();
    });
    win.webContents.on('will-navigate', (e, u) => {
      if (intercept(e.url ?? u)) e.preventDefault();
    });
    win.on('closed', () => finish(Object.assign(new Error('Sign-in cancelled.'), { cancelled: true })));
    win.loadURL(url.toString());
  });
}

async function msToken(params) {
  const res = await request(TOKEN_URL, { form: { client_id: MSA_CLIENT_ID, scope: SCOPE, ...params } });
  if (!res.ok) throw new Error(res.body?.error_description?.split('\r\n')[0] || 'Microsoft sign-in failed.');
  return res.body;
}

// ---------- Xbox Live → Minecraft ----------

async function minecraftLogin(msAccessToken) {
  const xbl = await request('https://user.auth.xboxlive.com/user/authenticate', {
    json: {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
  });
  if (!xbl.ok) throw new Error('Xbox Live sign-in failed.');

  const xsts = await request('https://xsts.auth.xboxlive.com/xsts/authorize', {
    json: {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.body.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    },
  });
  if (!xsts.ok) throw new Error(XSTS_ERRORS[xsts.body?.XErr] ?? 'Xbox Live authorization failed.');

  const uhs = xsts.body.DisplayClaims.xui[0].uhs;
  const mc = await request('https://api.minecraftservices.com/authentication/login_with_xbox', {
    json: { identityToken: `XBL3.0 x=${uhs};${xsts.body.Token}` },
  });
  if (mc.status === 403) {
    throw new Error("This Azure app isn't approved for Minecraft sign-in yet.");
  }
  if (!mc.ok) throw new Error('Minecraft sign-in failed.');

  const profile = await request('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.body.access_token}` },
  });
  if (profile.status === 404) throw new Error("This Microsoft account doesn't own Minecraft: Java Edition.");
  if (!profile.ok) throw new Error('Could not load your Minecraft profile.');

  return {
    uuid: profile.body.id,
    name: profile.body.name,
    skinUrl: profile.body.skins?.find((s) => s.state === 'ACTIVE')?.url ?? null,
    accessToken: mc.body.access_token,
    expiresAt: Date.now() + mc.body.expires_in * 1000,
  };
}

// ---------- Storage ----------

// Tokens are encrypted with the OS keychain (DPAPI on Windows) when available.
function seal(secret) {
  const json = JSON.stringify(secret);
  return safeStorage.isEncryptionAvailable()
    ? { enc: safeStorage.encryptString(json).toString('base64') }
    : { plain: json };
}

function unseal(sealed) {
  return JSON.parse(sealed.enc ? safeStorage.decryptString(Buffer.from(sealed.enc, 'base64')) : sealed.plain);
}

function toStored(mc, refreshToken) {
  return {
    id: mc.uuid,
    name: mc.name,
    skinUrl: mc.skinUrl,
    secret: seal({ refreshToken, accessToken: mc.accessToken, expiresAt: mc.expiresAt }),
  };
}

const loadStore = () => readJson(file(), { activeId: null, accounts: [] });

function publicState(store) {
  const dev = devOffline();
  const accounts = store.accounts.map(({ id, name, skinUrl }) => ({ id, name, skinUrl: skinUrl ?? null, offline: false }));
  if (dev) accounts.push(dev);
  const activeId = accounts.some((a) => a.id === store.activeId) ? store.activeId : (accounts[0]?.id ?? null);
  return { configured: Boolean(MSA_CLIENT_ID), activeId, accounts };
}

function upsert(store, entry) {
  const i = store.accounts.findIndex((a) => a.id === entry.id);
  if (i === -1) store.accounts.push(entry);
  else store.accounts[i] = entry;
}

// ---------- Public API ----------

async function listAccounts() {
  return publicState(await loadStore());
}

/** Returns the new account state, or null if the user closed the popup. */
async function login(parent) {
  if (!MSA_CLIENT_ID) {
    throw new Error("Microsoft sign-in isn't set up yet. Add your Azure client ID to electron/config.cjs.");
  }
  let auth;
  try {
    auth = await promptForCode(parent);
  } catch (err) {
    if (err.cancelled) return null;
    throw err;
  }
  const tokens = await msToken({ grant_type: 'authorization_code', code: auth.code, code_verifier: auth.verifier, redirect_uri: REDIRECT_URI });
  const mc = await minecraftLogin(tokens.access_token);

  return withLock(async () => {
    const store = await loadStore();
    upsert(store, toStored(mc, tokens.refresh_token));
    store.activeId = mc.uuid;
    await writeJson(file(), store);
    return publicState(store);
  });
}

function logout(id) {
  return withLock(async () => {
    const store = await loadStore();
    store.accounts = store.accounts.filter((a) => a.id !== id);
    if (store.activeId === id) store.activeId = store.accounts[0]?.id ?? null;
    await writeJson(file(), store);
    return publicState(store);
  });
}

function setActive(id) {
  return withLock(async () => {
    const store = await loadStore();
    const isDev = id === DEV_OFFLINE_ID && devOffline();
    if (!isDev && !store.accounts.some((a) => a.id === id)) throw new Error('Account not found.');
    store.activeId = id;
    await writeJson(file(), store);
    return publicState(store);
  });
}

/** Credentials for launching, refreshing the Minecraft token if it's about to expire. */
async function getLaunchAccount() {
  const store = await loadStore();
  const activeId = publicState(store).activeId;
  const dev = devOffline();
  if (dev && activeId === dev.id) {
    return { uuid: offlineUuid(dev.name), name: dev.name, accessToken: '0', offline: true };
  }
  const stored = store.accounts.find((a) => a.id === activeId);
  if (!stored) throw new Error('Sign in with a Microsoft account to play.');

  const secret = unseal(stored.secret);
  if (secret.expiresAt - Date.now() > 5 * 60_000) {
    return { uuid: stored.id, name: stored.name, accessToken: secret.accessToken };
  }

  let tokens;
  try {
    tokens = await msToken({ grant_type: 'refresh_token', refresh_token: secret.refreshToken });
  } catch {
    throw new Error(`Your session for ${stored.name} has expired. Sign in again.`);
  }
  const mc = await minecraftLogin(tokens.access_token);
  await withLock(async () => {
    const latest = await loadStore();
    upsert(latest, toStored(mc, tokens.refresh_token ?? secret.refreshToken));
    await writeJson(file(), latest);
  });
  return { uuid: mc.uuid, name: mc.name, accessToken: mc.accessToken };
}

/** Remembers a changed skin so the account's head updates without signing in again. */
function setSkinUrl(id, skinUrl) {
  return withLock(async () => {
    const store = await loadStore();
    const account = store.accounts.find((a) => a.id === id);
    if (!account) return;
    account.skinUrl = skinUrl;
    await writeJson(file(), store);
  });
}

module.exports = { listAccounts, login, logout, setActive, getLaunchAccount, setSkinUrl };
