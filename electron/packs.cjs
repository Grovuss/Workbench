const fsp = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');
const profiles = require('./profiles.cjs');
const paths = require('./paths.cjs');
const content = require('./content.cjs');
const curseforge = require('./curseforge.cjs');
const icons = require('./icons.cjs');
const { download, runPool, sha1 } = require('./launcher/http.cjs');
const { loaderVersions } = require('./launcher/loaders.cjs');
const { version: appVersion } = require('../package.json');

// ---------------------------------------------------------------------------
// .workbench pack format (version 1)
//
// A zip containing:
//   workbench.json   manifest (below)
//   icon.png         optional profile icon (PNG, JPEG, WebP or GIF despite the name)
//   overrides/      files copied into the profile's game folder as-is
//                    (config/, resourcepacks/, options.txt, mods not on Modrinth, …)
//
// workbench.json:
//   {
//     "format": 1,
//     "name": "My Pack",
//     "generator": "Workbench 0.2.0",
//     "exportedAt": "2026-10-31T12:00:00.000Z",
//     "game": { "minecraft": "1.21.1", "loader": "fabric", "loaderVersion": "0.16.9" },
//     "settings": { "memoryMb": 6144, "resolution": null },   // recommendations, optional
//     "mods": [
//       { "fileName": "sodium.jar", "enabled": true, "sha1": "…", "size": 123,
//         "url": "https://cdn.modrinth.com/…", "projectId": "AANobbMI", "versionId": "…", "title": "Sodium" }
//     ]
//   }
//
// Java arguments are never imported or exported: they can run arbitrary code.
// ---------------------------------------------------------------------------

const WORKBENCH_FORMAT = 1;

// Hosts pack mods may be downloaded from (Modrinth's .mrpack spec allows the same set).
const ALLOWED_DOWNLOAD_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']);

const EXPORTABLE = new Set(['config', 'resourcepacks', 'shaderpacks', 'options.txt', 'saves']);

function allowedUrl(url, hosts = ALLOWED_DOWNLOAD_HOSTS) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.has(u.hostname);
  } catch {
    return false;
  }
}

/** Joins a pack-relative path onto base, refusing anything that would land outside it. */
function safeJoin(base, rel) {
  const root = path.resolve(base);
  const dest = path.resolve(root, rel);
  if (!dest.startsWith(root + path.sep)) throw new Error(`Pack contains an unsafe path: ${rel}`);
  return dest;
}

async function extractFolder(zip, prefix, destDir) {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const dest = safeJoin(destDir, entry.entryName.slice(prefix.length));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, entry.getData());
  }
}

async function downloadFrom(urls, dest, opts, hosts) {
  const usable = urls.filter((url) => allowedUrl(url, hosts));
  if (!usable.length) throw new Error(`No allowed download source for ${path.basename(dest)}.`);
  let lastErr;
  for (const url of usable) {
    try {
      return await download(url, dest, opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Creates the profile, then runs `fill`; removes the half-made profile if anything fails. */
async function withNewProfile(input, fill) {
  const profile = await profiles.create(input);
  try {
    await fill(profile, profiles.gameDir(profile.id));
    return profiles.get(profile.id);
  } catch (err) {
    await profiles.remove(profile.id).catch(() => {});
    throw err;
  }
}

// ---------- Import ----------

async function importWorkbench(zip, onProgress) {
  const manifest = JSON.parse(zip.readAsText('workbench.json'));
  if (manifest.format !== WORKBENCH_FORMAT) {
    throw new Error('This .workbench file was made by a newer version of Workbench.');
  }
  const { minecraft, loader, loaderVersion } = manifest.game ?? {};

  return withNewProfile({ name: manifest.name, mcVersion: minecraft, loader, loaderVersion }, async (profile, dir) => {
    // Recommended settings are best-effort: memory may exceed this machine's RAM.
    const { memoryMb = null, resolution = null } = manifest.settings ?? {};
    await profiles.updateSettings(profile.id, { memoryMb }).catch(() => {});
    await profiles.updateSettings(profile.id, { resolution }).catch(() => {});

    const entries = manifest.mods ?? [];
    let done = 0;
    onProgress({ label: 'Downloading mods', done, total: entries.length });
    const recorded = [];
    await runPool(entries, 8, async (m) => {
      const fileName = content.safeFileName(m.fileName);
      const dest = path.join(content.modsDir(profile.id), m.enabled === false ? `${fileName}.disabled` : fileName);
      await downloadFrom([m.url], dest, { sha1: m.sha1, size: m.size });
      recorded.push({
        fileName,
        info: {
          sha1: m.sha1,
          size: m.size,
          projectId: m.projectId ?? null,
          versionId: m.versionId ?? null,
          title: m.title ?? null,
          url: m.url,
        },
      });
      onProgress({ label: 'Downloading mods', done: ++done, total: entries.length });
    });
    await content.recordInstalledMods(profile.id, recorded);

    onProgress({ label: 'Copying files', done: 0, total: 1 });
    await extractFolder(zip, 'overrides/', dir);

    const icon = zip.getEntry('icon.png');
    if (icon) await icons.setFromBuffer(profile.id, icon.getData()).catch(() => {});
  });
}

/** Packs downloaded from Modrinth are themselves Modrinth files: use the project's icon. */
async function modrinthPackIcon(profileId, packBuf) {
  const version = await content.modrinth(`/version_file/${sha1(packBuf)}?algorithm=sha1`);
  const project = await content.modrinth(`/project/${version.project_id}`);
  if (!project.icon_url || !allowedUrl(project.icon_url)) return;
  const res = await fetch(project.icon_url, { headers: { 'User-Agent': content.USER_AGENT } });
  if (res.ok) await icons.setFromBuffer(profileId, Buffer.from(await res.arrayBuffer()));
}

async function mrpackSelection(deps) {
  const mcVersion = deps.minecraft;
  if (deps['fabric-loader']) return { mcVersion, loader: 'fabric', loaderVersion: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { mcVersion, loader: 'quilt', loaderVersion: deps['quilt-loader'] };
  if (deps.neoforge) return { mcVersion, loader: 'neoforge', loaderVersion: deps.neoforge };
  if (deps.forge) {
    // Packs give "47.3.0"; Forge's own version ids are "1.20.1-47.3.0" (sometimes with a suffix).
    const list = await loaderVersions('forge', mcVersion);
    const full = list.find((v) => v.version === `${mcVersion}-${deps.forge}` || v.version.startsWith(`${mcVersion}-${deps.forge}-`));
    return { mcVersion, loader: 'forge', loaderVersion: full?.version ?? `${mcVersion}-${deps.forge}` };
  }
  return { mcVersion, loader: 'vanilla', loaderVersion: null };
}

async function importMrpack(zip, packBuf, onProgress) {
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const selection = await mrpackSelection(index.dependencies ?? {});

  return withNewProfile({ name: index.name, ...selection }, async (profile, dir) => {
    const files = (index.files ?? []).filter((f) => f.env?.client !== 'unsupported');
    let done = 0;
    onProgress({ label: 'Downloading mods', done, total: files.length });
    await runPool(files, 8, async (f) => {
      await downloadFrom(f.downloads ?? [], safeJoin(dir, f.path), { sha1: f.hashes?.sha1, size: f.fileSize });
      onProgress({ label: 'Downloading mods', done: ++done, total: files.length });
    });
    onProgress({ label: 'Copying files', done: 0, total: 1 });
    await extractFolder(zip, 'overrides/', dir);
    await extractFolder(zip, 'client-overrides/', dir);
    // Best effort: packs from elsewhere simply aren't found.
    await modrinthPackIcon(profile.id, packBuf).catch(() => {});
  });
}

/**
 * CurseForge pack zip: manifest.json lists project/file ids; files are fetched through
 * CurseForge's API. Authors can forbid launchers from downloading their files, so those
 * are returned as `missing` with a link for the player to download them by hand.
 */
async function importCurseForge(zip, onProgress) {
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  if (manifest.manifestType !== 'minecraftModpack') throw new Error('This CurseForge file isn’t a Minecraft modpack.');
  const loaders = manifest.minecraft?.modLoaders ?? [];
  const primary = loaders.find((l) => l.primary) ?? loaders[0];
  const selection = await mrpackSelection({
    minecraft: manifest.minecraft?.version,
    ...curseforge.loaderDependency(primary?.id),
  });
  const missing = [];

  const profile = await withNewProfile({ name: manifest.name, ...selection }, async (created, dir) => {
    const fileIds = (manifest.files ?? []).filter((f) => f.required !== false).map((f) => f.fileID);
    onProgress({ label: 'Looking up files on CurseForge', done: 0, total: 1 });
    const resolved = await curseforge.resolveFiles(fileIds);

    let done = 0;
    onProgress({ label: 'Downloading mods', done, total: resolved.length });
    await runPool(resolved, 8, async ({ file, mod }) => {
      const folder = curseforge.CLASS_FOLDERS[mod?.classId];
      const name = mod?.name ?? file.displayName ?? file.fileName;
      if (!folder) {
        missing.push({ name, fileName: file.fileName, url: curseforge.filePageUrl(file, mod), reason: 'unsupported' });
      } else if (!file.downloadUrl) {
        missing.push({ name, fileName: file.fileName, url: curseforge.filePageUrl(file, mod), reason: 'author' });
      } else {
        const dest = safeJoin(path.join(dir, folder), content.safeFileName(file.fileName));
        await downloadFrom([file.downloadUrl], dest, { sha1: curseforge.fileSha1(file), size: file.fileLength }, curseforge.CURSEFORGE_DOWNLOAD_HOSTS);
      }
      onProgress({ label: 'Downloading mods', done: ++done, total: resolved.length });
    });

    onProgress({ label: 'Copying files', done: 0, total: 1 });
    await extractFolder(zip, `${manifest.overrides || 'overrides'}/`, dir);
  });
  return { profile, missing };
}

/**
 * Imports a .workbench, .mrpack or CurseForge .zip as a new profile.
 * Resolves to { profile, missing }: files the player has to download themselves.
 */
async function importPack(filePath, onProgress) {
  const buf = await fsp.readFile(filePath);
  const zip = new AdmZip(buf);
  if (zip.getEntry('workbench.json')) return { profile: await importWorkbench(zip, onProgress), missing: [] };
  if (zip.getEntry('modrinth.index.json')) return { profile: await importMrpack(zip, buf, onProgress), missing: [] };
  if (zip.getEntry('manifest.json')) return importCurseForge(zip, onProgress);
  throw new Error('This file isn’t a modpack Workbench recognizes.');
}

// ---------- Modrinth modpacks ----------

const MODPACK_SORTS = new Set(['relevance', 'downloads', 'follows', 'newest', 'updated']);
const PACK_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'];

/** Modrinth modpack search; `loader` and `gameVersion` narrow it down. */
async function searchModpacks({ query = '', offset = 0, sort, category, loader, gameVersion } = {}) {
  const facets = [['project_type:modpack']];
  if (PACK_LOADERS.includes(loader)) facets.push([`categories:${loader}`]);
  if (gameVersion) facets.push([`versions:${String(gameVersion)}`]);
  if (category) facets.push([`categories:${String(category)}`]);
  const text = String(query).slice(0, 200);
  const params = new URLSearchParams({
    query: text,
    facets: JSON.stringify(facets),
    limit: '20',
    offset: String(Math.max(0, Number(offset) || 0)),
    index: MODPACK_SORTS.has(sort) ? sort : text ? 'relevance' : 'downloads',
  });
  const data = await content.modrinth(`/search?${params}`);
  return {
    total: data.total_hits,
    hits: data.hits.map((h) => ({
      projectId: h.project_id,
      title: h.title,
      description: h.description,
      author: h.author,
      iconUrl: h.icon_url || null,
      downloads: h.downloads,
      follows: h.follows,
      updatedAt: h.date_modified,
      loaders: (h.categories ?? []).filter((c) => PACK_LOADERS.includes(c)),
      gameVersions: h.versions ?? [],
    })),
  };
}

/** A modpack's versions, newest first. */
async function modpackVersions(projectId) {
  const versions = await content.modrinth(`/project/${encodeURIComponent(projectId)}/version`);
  return versions.map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    type: v.version_type,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    date: v.date_published,
  }));
}

/** Downloads a Modrinth modpack version (the newest release by default) and imports it as a new profile. */
async function installModpack(projectId, versionId, onProgress) {
  const project = await content.modrinth(`/project/${encodeURIComponent(projectId)}`);
  if (project.project_type !== 'modpack') throw new Error('That project isn’t a modpack.');
  let version;
  if (versionId) {
    version = await content.modrinth(`/version/${encodeURIComponent(versionId)}`);
    if (version.project_id !== project.id) throw new Error('That version belongs to a different project.');
  } else {
    const versions = await content.modrinth(`/project/${encodeURIComponent(project.id)}/version`);
    version = versions.find((v) => v.version_type === 'release') ?? versions[0];
    if (!version) throw new Error(`${project.title} has no versions to install.`);
  }
  const file = version.files.find((f) => f.primary && f.filename.endsWith('.mrpack')) ?? version.files.find((f) => f.filename.endsWith('.mrpack'));
  if (!file || !allowedUrl(file.url)) throw new Error(`${project.title} ${version.version_number} has no Modrinth pack file.`);

  onProgress({ label: `Downloading ${project.title}`, done: 0, total: 1 });
  const tmp = path.join(paths.root(), 'tmp', `${file.hashes.sha1}.mrpack`);
  try {
    await download(file.url, tmp, { sha1: file.hashes.sha1, size: file.size });
    const buf = await fsp.readFile(tmp);
    return { profile: await importMrpack(new AdmZip(buf), buf, onProgress), missing: [] };
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

// ---------- Export ----------

/** Writes a profile to a .workbench file. `include` picks extra folders (see EXPORTABLE). */
async function exportWorkbench(profileId, include, filePath) {
  const profile = await profiles.get(profileId);
  const dir = profiles.gameDir(profileId);
  const zip = new AdmZip();
  const manifestMods = [];

  for (const { fileName, enabled, info } of await content.listModsForExport(profileId)) {
    if (info.projectId && info.url && allowedUrl(info.url)) {
      manifestMods.push({
        fileName,
        enabled,
        sha1: info.sha1,
        size: info.size,
        url: info.url,
        projectId: info.projectId,
        versionId: info.versionId ?? null,
        title: info.title ?? null,
      });
    } else {
      // Not on Modrinth: ship the jar itself.
      zip.addLocalFile(path.join(content.modsDir(profileId), enabled ? fileName : `${fileName}.disabled`), 'overrides/mods/');
    }
  }

  for (const name of include ?? []) {
    if (!EXPORTABLE.has(name)) continue;
    const source = path.join(dir, name);
    const stat = await fsp.stat(source).catch(() => null);
    if (stat?.isDirectory()) zip.addLocalFolder(source, `overrides/${name}`);
    else if (stat?.isFile()) zip.addLocalFile(source, 'overrides/');
  }

  const manifest = {
    format: WORKBENCH_FORMAT,
    name: profile.name,
    generator: `Workbench ${appVersion}`,
    exportedAt: new Date().toISOString(),
    game: { minecraft: profile.mcVersion, loader: profile.loader, loaderVersion: profile.loaderVersion },
    settings: { memoryMb: profile.settings.memoryMb, resolution: profile.settings.resolution },
    mods: manifestMods,
  };
  zip.addFile('workbench.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  const icon = profile.icon && (await icons.read(profileId));
  if (icon) zip.addFile('icon.png', icon.buf);
  await zip.writeZipPromise(filePath);
  return { modsLinked: manifestMods.length };
}

module.exports = { importPack, exportWorkbench, searchModpacks, modpackVersions, installModpack };
