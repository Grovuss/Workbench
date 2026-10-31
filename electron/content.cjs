const fsp = require('node:fs/promises');
const path = require('node:path');
const profiles = require('./profiles.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');
const { download, runPool, sha1 } = require('./launcher/http.cjs');
const { version: appVersion } = require('../package.json');

// Mods, resource packs, shader packs and data packs: installed from Modrinth or added
// by hand, listed with their Modrinth details, toggled by renaming to "<file>.disabled".

const MODRINTH_API = 'https://api.modrinth.com/v2';
// Modrinth asks for a User-Agent that identifies the app.
const USER_AGENT = `Grovuss/Workbench/${appVersion}`;

const KINDS = {
  mod: { folder: 'mods', ext: '.jar', projectType: 'mod', noun: 'mod' },
  resourcepack: { folder: 'resourcepacks', ext: '.zip', projectType: 'resourcepack', noun: 'resource pack' },
  shader: { folder: 'shaderpacks', ext: '.zip', projectType: 'shader', noun: 'shader pack' },
  datapack: { folder: 'datapacks', ext: '.zip', projectType: 'datapack', noun: 'data pack', perWorld: true },
};

// Quilt can also load Fabric mods.
const MOD_LOADERS = {
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge'],
  neoforge: ['neoforge'],
};

/** Iris, the shader mod for Fabric, Quilt and NeoForge. */
const IRIS_PROJECT_ID = 'YL57xq9U';

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

/** Modrinth "loaders" a profile can use for a kind of content. */
function modrinthLoaders(kind, profile) {
  switch (kind) {
    case 'mod': {
      const loaders = MOD_LOADERS[profile.loader];
      if (!loaders) throw new Error('Vanilla profiles can’t use mods. Pick a mod loader in this profile’s settings.');
      return loaders;
    }
    case 'shader':
      if (profile.loader === 'vanilla') {
        throw new Error('Shaders need a mod loader. Pick Fabric, Quilt or NeoForge in this profile’s settings.');
      }
      return profile.loader === 'forge' ? ['optifine'] : ['iris'];
    case 'resourcepack':
      return ['minecraft'];
    case 'datapack':
      return ['datapack'];
  }
}

/** Rejects anything that isn't a plain file name, so callers can't escape the content folder. */
function safeFileName(name) {
  const clean = String(name ?? '');
  if (!clean || path.basename(clean) !== clean || clean === '.' || clean === '..') throw new Error('Invalid file name.');
  return clean;
}

const exists = (file) => fsp.access(file).then(() => true, () => false);

/**
 * Resolves a target ({ profileId, kind, world? }) to its folder and metadata file.
 * Data packs live in a world: saves/<world>/datapacks.
 */
async function locate({ profileId, kind, world } = {}) {
  const spec = KINDS[kind];
  if (!spec) throw new Error('Unknown content type.');
  const profile = await profiles.get(profileId);
  const gameDir = profiles.gameDir(profileId);
  if (spec.perWorld) {
    const worldDir = path.join(gameDir, 'saves', safeFileName(world));
    if (!(await exists(path.join(worldDir, 'level.dat')))) throw new Error('World not found.');
    return { profile, kind, spec, dir: path.join(worldDir, spec.folder), metaFile: path.join(worldDir, 'workbench-datapacks.json') };
  }
  return {
    profile,
    kind,
    spec,
    dir: path.join(gameDir, spec.folder),
    metaFile: path.join(gameDir, `workbench-${spec.folder}.json`),
  };
}

// What we know about each file, keyed by file name without ".disabled":
// { sha1, size, projectId?, versionId?, versionNumber?, title?, iconUrl?, url?, update?, hashChecked?, detailsChecked? }
const loadMeta = async (loc) => (await readJson(loc.metaFile, { files: {} })).files;
const saveMeta = (loc, files) => writeJson(loc.metaFile, { files });

// ---------- Installed content ----------

async function scan(loc) {
  const { dir, spec } = loc;
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const meta = await loadMeta(loc);
  const next = {};
  const items = [];
  let changed = false;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    const enabled = lower.endsWith(spec.ext);
    if (!enabled && !lower.endsWith(`${spec.ext}.disabled`)) continue;
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

  // Fill in what we don't know yet from Modrinth. Each step runs once per file; offline, it's retried next time.
  // 1. Version details by hash, for files added by hand or by a pack import.
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

  // 2. Title and icon, for every identified file.
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

  if (changed) {
    await fsp.mkdir(path.dirname(loc.metaFile), { recursive: true });
    await saveMeta(loc, next);
  }
  return items;
}

function toPublic(loc, { fileName, enabled, info }) {
  return {
    fileName,
    enabled,
    size: info.size,
    title: info.title ?? fileName.slice(0, -loc.spec.ext.length),
    versionNumber: info.versionNumber ?? null,
    projectId: info.projectId ?? null,
    iconUrl: info.iconUrl ?? null,
    updateVersion: info.update?.versionNumber ?? null,
  };
}

async function listUnlocked(loc) {
  const items = await scan(loc);
  return items.map((i) => toPublic(loc, i)).sort((a, b) => a.title.localeCompare(b.title));
}

const list = (target) => withLock(async () => listUnlocked(await locate(target)));

/** Mods with everything packs need to re-download them. */
const listModsForExport = (profileId) => withLock(async () => scan(await locate({ profileId, kind: 'mod' })));

function setEnabled(target, fileName, enabled) {
  return withLock(async () => {
    const loc = await locate(target);
    const on = path.join(loc.dir, safeFileName(fileName));
    const off = `${on}.disabled`;
    await fsp.rename(enabled ? off : on, enabled ? on : off);
    return listUnlocked(loc);
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
 * Copies files from disk into the target folder. Files Modrinth recognises replace
 * other versions of the same project, like an install would.
 */
function addFiles(target, filePaths) {
  return withLock(async () => {
    const loc = await locate(target);
    const { ext, noun } = loc.spec;
    const sources = [];
    for (const src of filePaths) {
      const base = safeFileName(path.basename(String(src)));
      const name = base.toLowerCase().endsWith(ext) ? base.slice(0, -ext.length) + ext : base;
      if (!name.endsWith(ext)) throw new Error(`${name} isn’t a ${ext} file.`);
      if (!(await isZip(src))) throw new Error(`${name} isn’t a valid ${noun}.`);
      sources.push({ src, name });
    }

    await fsp.mkdir(loc.dir, { recursive: true });
    for (const { src, name } of sources) {
      await fsp.copyFile(src, path.join(loc.dir, name));
      await fsp.rm(path.join(loc.dir, `${name}.disabled`), { force: true });
    }

    const added = new Set(sources.map((s) => s.name));
    const items = await scan(loc);
    const addedProjects = new Set(items.filter((i) => added.has(i.fileName) && i.info.projectId).map((i) => i.info.projectId));
    for (const item of items) {
      if (added.has(item.fileName) || !addedProjects.has(item.info.projectId)) continue;
      await fsp.rm(path.join(loc.dir, item.fileName), { force: true });
      await fsp.rm(path.join(loc.dir, `${item.fileName}.disabled`), { force: true });
    }
    return listUnlocked(loc);
  });
}

function remove(target, fileName) {
  return withLock(async () => {
    const loc = await locate(target);
    const file = path.join(loc.dir, safeFileName(fileName));
    await fsp.rm(file, { force: true });
    await fsp.rm(`${file}.disabled`, { force: true });
    return listUnlocked(loc);
  });
}

// ---------- Modrinth ----------

async function search(target, { query = '', offset = 0 } = {}) {
  const { kind, profile } = await locate(target);
  const facets = [
    [`project_type:${KINDS[kind].projectType}`],
    modrinthLoaders(kind, profile).map((l) => `categories:${l}`),
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

async function newestCompatible(projectId, kind, profile) {
  const params = new URLSearchParams({
    loaders: JSON.stringify(modrinthLoaders(kind, profile)),
    game_versions: JSON.stringify([profile.mcVersion]),
  });
  const versions = await modrinth(`/project/${encodeURIComponent(projectId)}/version?${params}`);
  return versions.find((v) => v.version_type === 'release') ?? versions[0] ?? null;
}

/** Shared state for one install/update run: where files go, their metadata and what's been handled. */
async function installContext(loc) {
  const meta = await loadMeta(loc);
  return {
    loc,
    meta,
    installed: new Set(Object.values(meta).map((m) => m.projectId).filter(Boolean)),
    visited: new Set(),
  };
}

/** Downloads a version's file in place of any other version of the project, then (for mods) its required dependencies. */
async function placeVersion(ctx, projectId, version, { title, iconUrl }, enabled = true) {
  const { dir, kind, spec } = ctx.loc;
  // Some projects ship a mod jar and a data pack zip in one version; take the one for this folder.
  const files = version.files.filter((f) => f.filename.toLowerCase().endsWith(spec.ext));
  const file = files.find((f) => f.primary) ?? files[0];
  if (!file) throw new Error(`${title} has no ${spec.ext} file to install.`);
  const fileName = safeFileName(file.filename);

  for (const [name, m] of Object.entries(ctx.meta)) {
    if (m.projectId === projectId && m.versionId !== version.id) {
      await fsp.rm(path.join(dir, name), { force: true });
      await fsp.rm(path.join(dir, `${name}.disabled`), { force: true });
      delete ctx.meta[name];
    }
  }
  await download(file.url, path.join(dir, enabled ? fileName : `${fileName}.disabled`), {
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

  if (kind !== 'mod') return;
  for (const dep of version.dependencies ?? []) {
    if (dep.dependency_type !== 'required') continue;
    const depId = dep.project_id ?? (dep.version_id && (await modrinth(`/version/${dep.version_id}`)).project_id);
    if (depId && !ctx.installed.has(depId)) await installProject(ctx, depId, false);
  }
}

async function installProject(ctx, projectId, isRoot) {
  if (ctx.visited.has(projectId)) return;
  ctx.visited.add(projectId);
  const { kind, profile, spec } = ctx.loc;
  const [version, project] = await Promise.all([
    newestCompatible(projectId, kind, profile),
    modrinth(`/project/${encodeURIComponent(projectId)}`),
  ]);
  if (!version) {
    if (isRoot) throw new Error(`${project.title} has no ${spec.noun} version for ${profile.mcVersion} on this profile.`);
    return; // Optional-in-practice dependency we can't satisfy; the game will say if it matters.
  }
  await placeVersion(ctx, projectId, version, { title: project.title, iconUrl: project.icon_url ?? null });
}

/** Installs the newest compatible version of a project (plus required dependencies for mods). */
function install(target, projectId) {
  return withLock(async () => {
    const loc = await locate(target);
    const ctx = await installContext(loc);
    try {
      await installProject(ctx, projectId, true);
    } finally {
      await saveMeta(loc, ctx.meta);
    }
    return listUnlocked(loc);
  });
}

// ---------- Updates ----------

/**
 * Looks up the newest compatible version of every identified file and records it as `update`.
 * Files on a release stay on releases even when a newer beta exists.
 */
function checkUpdates(target) {
  return withLock(async () => {
    const loc = await locate(target);
    const { kind, profile } = loc;
    const items = await scan(loc);
    const known = items.filter((i) => i.info.projectId);
    if (known.length) {
      const hashes = known.map((i) => i.info.sha1);
      const [current, latest] = await Promise.all([
        modrinth('/version_files', { hashes, algorithm: 'sha1' }),
        modrinth('/version_files/update', {
          hashes,
          algorithm: 'sha1',
          loaders: modrinthLoaders(kind, profile),
          game_versions: [profile.mcVersion],
        }),
      ]);
      await runPool(known, 6, async ({ info }) => {
        const cur = current[info.sha1];
        let next = latest[info.sha1];
        if (next && cur?.version_type === 'release' && next.version_type !== 'release') {
          next = await newestCompatible(info.projectId, kind, profile);
        }
        const currentId = cur?.id ?? info.versionId;
        info.update = next && next.id !== currentId ? { versionId: next.id, versionNumber: next.version_number } : null;
      });
      await saveMeta(loc, Object.fromEntries(items.map((i) => [i.fileName, i.info])));
    }
    return listUnlocked(loc);
  });
}

/** Applies updates found by checkUpdates, for the given files or all of them. Keeps disabled files disabled. */
function update(target, fileNames) {
  return withLock(async () => {
    const loc = await locate(target);
    const ctx = await installContext(loc);
    const wanted = fileNames ? new Set(fileNames.map(safeFileName)) : null;
    const targets = Object.entries(ctx.meta).filter(([name, m]) => m.update && m.projectId && (!wanted || wanted.has(name)));
    try {
      await runPool(targets, 6, async ([name, m]) => {
        if (ctx.visited.has(m.projectId)) return;
        ctx.visited.add(m.projectId);
        const enabled = await exists(path.join(loc.dir, name));
        const version = await modrinth(`/version/${encodeURIComponent(m.update.versionId)}`);
        await placeVersion(ctx, m.projectId, version, { title: m.title, iconUrl: m.iconUrl }, enabled);
      });
    } finally {
      await saveMeta(loc, ctx.meta);
    }
    return listUnlocked(loc);
  });
}

/** Records metadata for mods a pack import downloaded, so they show with titles straight away. */
function recordInstalledMods(profileId, entries) {
  return withLock(async () => {
    const loc = await locate({ profileId, kind: 'mod' });
    const meta = await loadMeta(loc);
    // Left unchecked so the next scan fills in version numbers and icons from Modrinth.
    for (const e of entries) meta[e.fileName] = { ...e.info };
    await saveMeta(loc, meta);
  });
}

const modsDir = (profileId) => path.join(profiles.gameDir(profileId), KINDS.mod.folder);

/** The folder a target's files live in. */
const folder = async (target) => (await locate(target)).dir;

module.exports = {
  IRIS_PROJECT_ID,
  folder,
  list,
  setEnabled,
  addFiles,
  remove,
  search,
  install,
  checkUpdates,
  update,
  listModsForExport,
  recordInstalledMods,
  modsDir,
  safeFileName,
  modrinth,
  USER_AGENT,
};
