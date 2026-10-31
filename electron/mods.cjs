const fsp = require('node:fs/promises');
const path = require('node:path');
const profiles = require('./profiles.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');
const { download, sha1 } = require('./launcher/http.cjs');
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
// { sha1, size, projectId?, versionId?, versionNumber?, title?, iconUrl?, url?, checked? }
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

  // Identify jars added by hand (or by a pack import) through Modrinth's hash lookup.
  const unknown = items.filter((i) => !i.info.projectId && !i.info.checked);
  if (unknown.length) {
    try {
      const byHash = await modrinth('/version_files', { hashes: unknown.map((i) => i.info.sha1), algorithm: 'sha1' });
      const projectIds = new Set();
      for (const item of unknown) {
        item.info.checked = true;
        const version = byHash[item.info.sha1];
        if (!version) continue;
        const file = version.files.find((f) => f.hashes.sha1 === item.info.sha1);
        Object.assign(item.info, {
          projectId: version.project_id,
          versionId: version.id,
          versionNumber: version.version_number,
          url: file?.url ?? null,
        });
        projectIds.add(version.project_id);
      }
      if (projectIds.size) {
        const projects = await modrinth(`/projects?ids=${encodeURIComponent(JSON.stringify([...projectIds]))}`);
        for (const project of projects) {
          for (const item of unknown) {
            if (item.info.projectId === project.id) Object.assign(item.info, { title: project.title, iconUrl: project.icon_url ?? null });
          }
        }
      }
      changed = true;
    } catch {
      // Offline: show them as local files and try again next time.
    }
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

/** Installs the newest compatible version of a project plus its required dependencies. */
function install(profileId, projectId) {
  return withLock(async () => {
    const profile = await profiles.get(profileId);
    const dir = modsDir(profileId);
    const meta = await loadMeta(profileId);
    const installed = new Set(Object.values(meta).map((m) => m.projectId).filter(Boolean));
    const visited = new Set();

    const installOne = async (pid, isRoot) => {
      if (visited.has(pid)) return;
      visited.add(pid);
      const [version, project] = await Promise.all([newestCompatible(pid, profile), modrinth(`/project/${encodeURIComponent(pid)}`)]);
      if (!version) {
        if (isRoot) throw new Error(`${project.title} has no version for ${profile.mcVersion} on this loader.`);
        return; // Optional-in-practice dependency we can't satisfy; the game will say if it matters.
      }
      const file = version.files.find((f) => f.primary) ?? version.files[0];
      const fileName = safeFileName(file.filename);

      // Replace any other version of the same project.
      for (const [name, m] of Object.entries(meta)) {
        if (m.projectId === pid && name !== fileName) {
          await fsp.rm(path.join(dir, name), { force: true });
          await fsp.rm(path.join(dir, `${name}.disabled`), { force: true });
          delete meta[name];
        }
      }
      await download(file.url, path.join(dir, fileName), { sha1: file.hashes.sha1, size: file.size });
      meta[fileName] = {
        sha1: file.hashes.sha1,
        size: file.size,
        projectId: pid,
        versionId: version.id,
        versionNumber: version.version_number,
        title: project.title,
        iconUrl: project.icon_url ?? null,
        url: file.url,
        checked: true,
      };
      installed.add(pid);

      for (const dep of version.dependencies ?? []) {
        if (dep.dependency_type !== 'required') continue;
        const depId = dep.project_id ?? (dep.version_id && (await modrinth(`/version/${dep.version_id}`)).project_id);
        if (depId && !installed.has(depId)) await installOne(depId, false);
      }
    };

    await installOne(projectId, true);
    await saveMeta(profileId, meta);
    return listUnlocked(profileId);
  });
}

/** Records metadata for jars a pack import downloaded, so they show with titles straight away. */
function recordInstalled(profileId, entries) {
  return withLock(async () => {
    const meta = await loadMeta(profileId);
    for (const e of entries) meta[e.fileName] = { ...e.info, checked: true };
    await saveMeta(profileId, meta);
  });
}

module.exports = { list, listForExport, setEnabled, remove, search, install, recordInstalled, modsDir, safeFileName };
