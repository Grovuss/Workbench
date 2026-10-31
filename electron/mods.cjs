const fsp = require('node:fs/promises');
const path = require('node:path');
const profiles = require('./profiles.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');
const { download, runPool, sha1 } = require('./launcher/http.cjs');
const { version: appVersion } = require('../package.json');

const MODRINTH_API = 'https://api.modrinth.com/v2';
// Modrinth asks for a User-Agent that identifies the app.
const USER_AGENT = `Grovuss/Workbench/${appVersion}`;

// Quilt can also load Fabric mods.
const MODRINTH_LOADERS = {
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge'],
  neoforge: ['neoforge'],
};

const withLock = createLock();

async function modrinth(pathname, body) {
  const res = await fetch(MODRINTH_API + pathname, {
    method: body ? 'POST' : 'GET',
    headers: { 'User-Agent': USER_AGENT, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Modrinth request failed (${res.status}).`);
  return res.json();
}

function modLoaders(profile) {
  const loaders = MODRINTH_LOADERS[profile.loader];
  if (!loaders) throw new Error('Vanilla profiles can’t use mods. Pick a mod loader in this profile’s settings.');
  return loaders;
}

const modsDir = (profileId) => path.join(profiles.gameDir(profileId), 'mods');
const metaFile = (profileId) => path.join(profiles.gameDir(profileId), 'workbench-mods.json');

// What we know about each jar, keyed by file name without ".disabled":
// { sha1, size, projectId?, versionId?, versionNumber?, title?, iconUrl?, url?, update?, hashChecked?, detailsChecked? }
const loadMeta = async (profileId) => (await readJson(metaFile(profileId), { files: {} })).files;
const saveMeta = (profileId, files) => writeJson(metaFile(profileId), { files });

/** Rejects anything that isn't a plain file name, so callers can't escape the mods folder. */
function safeFileName(name) {
  const clean = String(name ?? '');
  if (!clean || path.basename(clean) !== clean) throw new Error('Invalid file name.');
  return clean;
}

// ---------- Installed mods ----------

async function scanMods(profileId) {
  const dir = modsDir(profileId);
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const meta = await loadMeta(profileId);
  const next = {};
  const items = [];
  let changed = false;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const enabled = entry.name.endsWith('.jar');
    if (!enabled && !entry.name.endsWith('.jar.disabled')) continue;
    const fileName = enabled ? entry.name : entry.name.slice(0, -'.disabled'.length);
    const { size } = await fsp.stat(path.join(dir, entry.name));
    let info = meta[fileName];
    if (!info || info.size !== size) {
      info = { sha1: sha1(await fsp.readFile(path.join(dir, entry.name))), size };
      changed = true;
    }
    next[fileName] = info;
    items.push({ fileName, enabled, info });
  }
  if (Object.keys(meta).length !== Object.keys(next).length) changed = true;

  // Fill in what we don't know yet from Modrinth. Each step runs once per jar; offline, it's retried next time.
  // 1. Version details by hash, for jars added by hand or by a pack import.
  const unhashed = items.filter((i) => !i.info.hashChecked);
  if (unhashed.length) {
    try {
      const byHash = await modrinth('/version_files', { hashes: unhashed.map((i) => i.info.sha1), algorithm: 'sha1' });
      for (const item of unhashed) {
        item.info.hashChecked = true;
        const version = byHash[item.info.sha1];
        if (!version) continue;
        const file = version.files.find((f) => f.hashes.sha1 === item.info.sha1);
        Object.assign(item.info, {
          projectId: version.project_id,
          versionId: version.id,
          versionNumber: version.version_number,
          url: file?.url ?? item.info.url ?? null,
        });
      }
      changed = true;
    } catch {}
  }

  // 2. Title and icon, for every identified jar.
  const undetailed = items.filter((i) => i.info.projectId && !i.info.detailsChecked);
  if (undetailed.length) {
    try {
      const ids = [...new Set(undetailed.map((i) => i.info.projectId))];
      const projects = new Map();
      for (let n = 0; n < ids.length; n += 100) {
        const batch = await modrinth(`/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(n, n + 100)))}`);
        for (const project of batch) projects.set(project.id, project);
      }
      for (const item of undetailed) {
        const project = projects.get(item.info.projectId);
        if (project) Object.assign(item.info, { title: project.title, iconUrl: project.icon_url ?? null });
        item.info.detailsChecked = true;
      }
      changed = true;
    } catch {}
  }

  if (changed) await saveMeta(profileId, next);
  return items;
}

function toPublic({ fileName, enabled, info }) {
  return {
    fileName,
    enabled,
    size: info.size,
    title: info.title ?? fileName.replace(/\.jar$/, ''),
    versionNumber: info.versionNumber ?? null,
    projectId: info.projectId ?? null,
    iconUrl: info.iconUrl ?? null,
    updateVersion: info.update?.versionNumber ?? null,
  };
}

async function listUnlocked(profileId) {
  const items = await scanMods(profileId);
  return items.map(toPublic).sort((a, b) => a.title.localeCompare(b.title));
}

const list = (profileId) => withLock(() => listUnlocked(profileId));

/** Mods with everything packs need to re-download them. */
const listForExport = (profileId) => withLock(() => scanMods(profileId));

function setEnabled(profileId, fileName, enabled) {
  return withLock(async () => {
    const name = safeFileName(fileName);
    const on = path.join(modsDir(profileId), name);
    const off = `${on}.disabled`;
    await fsp.rename(enabled ? off : on, enabled ? on : off);
    return listUnlocked(profileId);
  });
}

const isZip = async (file) => {
  const handle = await fsp.open(file);
  try {
    const head = Buffer.alloc(2);
    await handle.read(head, 0, 2, 0);
    return head.toString('latin1') === 'PK';
  } finally {
    await handle.close();
  }
};

/**
 * Copies jars from disk into the profile. Jars Modrinth recognises replace other
 * versions of the same mod, like an install would.
 */
function addFiles(profileId, filePaths) {
  return withLock(async () => {
    await profiles.get(profileId);
    const dir = modsDir(profileId);
    const sources = [];
    for (const src of filePaths) {
      const name = safeFileName(path.basename(String(src))).replace(/\.jar$/i, '.jar');
      if (!name.endsWith('.jar')) throw new Error(`${name} isn’t a .jar file.`);
      if (!(await isZip(src))) throw new Error(`${name} isn’t a valid mod jar.`);
      sources.push({ src, name });
    }

    await fsp.mkdir(dir, { recursive: true });
    for (const { src, name } of sources) {
      await fsp.copyFile(src, path.join(dir, name));
      await fsp.rm(path.join(dir, `${name}.disabled`), { force: true });
    }

    const added = new Set(sources.map((s) => s.name));
    const items = await scanMods(profileId);
    const addedProjects = new Set(items.filter((i) => added.has(i.fileName) && i.info.projectId).map((i) => i.info.projectId));
    for (const item of items) {
      if (added.has(item.fileName) || !addedProjects.has(item.info.projectId)) continue;
      await fsp.rm(path.join(dir, item.fileName), { force: true });
      await fsp.rm(path.join(dir, `${item.fileName}.disabled`), { force: true });
    }
    return listUnlocked(profileId);
  });
}

function remove(profileId, fileName) {
  return withLock(async () => {
    const name = safeFileName(fileName);
    const file = path.join(modsDir(profileId), name);
    await fsp.rm(file, { force: true });
    await fsp.rm(`${file}.disabled`, { force: true });
    return listUnlocked(profileId);
  });
}

// ---------- Modrinth ----------

async function search(profileId, { query = '', offset = 0 } = {}) {
  const profile = await profiles.get(profileId);
  const facets = [
    ['project_type:mod'],
    modLoaders(profile).map((l) => `categories:${l}`),
    [`versions:${profile.mcVersion}`],
  ];
  const params = new URLSearchParams({
    query,
    facets: JSON.stringify(facets),
    limit: '20',
    offset: String(offset),
    index: query ? 'relevance' : 'downloads',
  });
  const data = await modrinth(`/search?${params}`);
  return {
    total: data.total_hits,
    hits: data.hits.map((h) => ({
      projectId: h.project_id,
      title: h.title,
      description: h.description,
      author: h.author,
      iconUrl: h.icon_url || null,
      downloads: h.downloads,
    })),
  };
}

async function newestCompatible(projectId, profile) {
  const params = new URLSearchParams({
    loaders: JSON.stringify(modLoaders(profile)),
    game_versions: JSON.stringify([profile.mcVersion]),
  });
  const versions = await modrinth(`/project/${encodeURIComponent(projectId)}/version?${params}`);
  return versions.find((v) => v.version_type === 'release') ?? versions[0] ?? null;
}

const exists = (file) => fsp.access(file).then(() => true, () => false);

/** Shared state for one install/update run: the profile, its mod metadata and what's been handled. */
async function installContext(profileId) {
  const profile = await profiles.get(profileId);
  const meta = await loadMeta(profileId);
  return {
    profile,
    dir: modsDir(profileId),
    meta,
    installed: new Set(Object.values(meta).map((m) => m.projectId).filter(Boolean)),
    visited: new Set(),
  };
}

/** Downloads a version's jar in place of any other version of the project, then its required dependencies. */
async function placeVersion(ctx, projectId, version, { title, iconUrl }, enabled = true) {
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  const fileName = safeFileName(file.filename);

  for (const [name, m] of Object.entries(ctx.meta)) {
    if (m.projectId === projectId && m.versionId !== version.id) {
      await fsp.rm(path.join(ctx.dir, name), { force: true });
      await fsp.rm(path.join(ctx.dir, `${name}.disabled`), { force: true });
      delete ctx.meta[name];
    }
  }
  await download(file.url, path.join(ctx.dir, enabled ? fileName : `${fileName}.disabled`), {
    sha1: file.hashes.sha1,
    size: file.size,
  });
  ctx.meta[fileName] = {
    sha1: file.hashes.sha1,
    size: file.size,
    projectId,
    versionId: version.id,
    versionNumber: version.version_number,
    title,
    iconUrl,
    url: file.url,
    hashChecked: true,
    detailsChecked: true,
  };
  ctx.installed.add(projectId);

  for (const dep of version.dependencies ?? []) {
    if (dep.dependency_type !== 'required') continue;
    const depId = dep.project_id ?? (dep.version_id && (await modrinth(`/version/${dep.version_id}`)).project_id);
    if (depId && !ctx.installed.has(depId)) await installProject(ctx, depId, false);
  }
}

async function installProject(ctx, projectId, isRoot) {
  if (ctx.visited.has(projectId)) return;
  ctx.visited.add(projectId);
  const [version, project] = await Promise.all([
    newestCompatible(projectId, ctx.profile),
    modrinth(`/project/${encodeURIComponent(projectId)}`),
  ]);
  if (!version) {
    if (isRoot) throw new Error(`${project.title} has no version for ${ctx.profile.mcVersion} on this loader.`);
    return; // Optional-in-practice dependency we can't satisfy; the game will say if it matters.
  }
  await placeVersion(ctx, projectId, version, { title: project.title, iconUrl: project.icon_url ?? null });
}

/** Installs the newest compatible version of a project plus its required dependencies. */
function install(profileId, projectId) {
  return withLock(async () => {
    const ctx = await installContext(profileId);
    try {
      await installProject(ctx, projectId, true);
    } finally {
      await saveMeta(profileId, ctx.meta);
    }
    return listUnlocked(profileId);
  });
}

// ---------- Updates ----------

/**
 * Looks up the newest compatible version of every identified mod and records it as `update`.
 * Mods on a release stay on releases even when a newer beta exists.
 */
function checkUpdates(profileId) {
  return withLock(async () => {
    const profile = await profiles.get(profileId);
    const items = await scanMods(profileId);
    const known = items.filter((i) => i.info.projectId);
    if (known.length) {
      const hashes = known.map((i) => i.info.sha1);
      const [current, latest] = await Promise.all([
        modrinth('/version_files', { hashes, algorithm: 'sha1' }),
        modrinth('/version_files/update', {
          hashes,
          algorithm: 'sha1',
          loaders: modLoaders(profile),
          game_versions: [profile.mcVersion],
        }),
      ]);
      await runPool(known, 6, async ({ info }) => {
        const cur = current[info.sha1];
        let next = latest[info.sha1];
        if (next && cur?.version_type === 'release' && next.version_type !== 'release') {
          next = await newestCompatible(info.projectId, profile);
        }
        const currentId = cur?.id ?? info.versionId;
        info.update = next && next.id !== currentId ? { versionId: next.id, versionNumber: next.version_number } : null;
      });
      await saveMeta(profileId, Object.fromEntries(items.map((i) => [i.fileName, i.info])));
    }
    return listUnlocked(profileId);
  });
}

/** Applies updates found by checkUpdates, for the given files or all of them. Keeps disabled mods disabled. */
function update(profileId, fileNames) {
  return withLock(async () => {
    const ctx = await installContext(profileId);
    const wanted = fileNames ? new Set(fileNames.map(safeFileName)) : null;
    const targets = Object.entries(ctx.meta).filter(([name, m]) => m.update && m.projectId && (!wanted || wanted.has(name)));
    try {
      await runPool(targets, 6, async ([name, m]) => {
        if (ctx.visited.has(m.projectId)) return;
        ctx.visited.add(m.projectId);
        const enabled = await exists(path.join(ctx.dir, name));
        const version = await modrinth(`/version/${encodeURIComponent(m.update.versionId)}`);
        await placeVersion(ctx, m.projectId, version, { title: m.title, iconUrl: m.iconUrl }, enabled);
      });
    } finally {
      await saveMeta(profileId, ctx.meta);
    }
    return listUnlocked(profileId);
  });
}

/** Records metadata for jars a pack import downloaded, so they show with titles straight away. */
function recordInstalled(profileId, entries) {
  return withLock(async () => {
    const meta = await loadMeta(profileId);
    // Left unchecked so the next scan fills in version numbers and icons from Modrinth.
    for (const e of entries) meta[e.fileName] = { ...e.info };
    await saveMeta(profileId, meta);
  });
}

module.exports = { list, listForExport, setEnabled, addFiles, remove, search, install, checkUpdates, update, recordInstalled, modsDir, safeFileName, modrinth, USER_AGENT };
