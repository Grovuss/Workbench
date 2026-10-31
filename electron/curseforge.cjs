const { CURSEFORGE_API_KEY } = require('./config.cjs');
const { version: appVersion } = require('../package.json');

// CurseForge's API needs a key from https://console.curseforge.com (set it up in config.cjs).
const CF_API = 'https://api.curseforge.com/v1';

// Hosts CurseForge serves files from.
const CURSEFORGE_DOWNLOAD_HOSTS = new Set(['edge.forgecdn.net', 'mediafilez.forgecdn.net']);

// CurseForge "classId" → profile folder. Anything else (data packs, worlds, …) is reported as skipped.
const CLASS_FOLDERS = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' };

// Hash algorithms in file metadata.
const SHA1 = 1;

const enabled = () => Boolean(CURSEFORGE_API_KEY);

async function cf(pathname, body) {
  if (!enabled()) throw new Error('CurseForge packs aren’t available yet: Workbench is waiting on a CurseForge API key.');
  const res = await fetch(CF_API + pathname, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-api-key': CURSEFORGE_API_KEY,
      Accept: 'application/json',
      'User-Agent': `Grovuss/Workbench/${appVersion}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`CurseForge request failed (${res.status}).`);
  return (await res.json()).data;
}

/** Looks up pack files and their projects, in batches. Returns [{ file, mod }]. */
async function resolveFiles(fileIds) {
  const files = [];
  for (let n = 0; n < fileIds.length; n += 500) files.push(...(await cf('/mods/files', { fileIds: fileIds.slice(n, n + 500) })));
  const modIds = [...new Set(files.map((f) => f.modId))];
  const mods = new Map();
  for (let n = 0; n < modIds.length; n += 500) {
    for (const mod of await cf('/mods', { modIds: modIds.slice(n, n + 500) })) mods.set(mod.id, mod);
  }
  return files.map((file) => ({ file, mod: mods.get(file.modId) ?? null }));
}

const fileSha1 = (file) => file.hashes?.find((h) => h.algo === SHA1)?.value ?? null;

/** The CurseForge page for a file, where players download files the author doesn't allow launchers to fetch. */
function filePageUrl(file, mod) {
  const base = mod?.links?.websiteUrl;
  return base ? `${base}/files/${file.id}` : `https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(file.fileName)}`;
}

/** "forge-47.2.0" → the loader key and version mrpackSelection understands. */
function loaderDependency(id) {
  const match = /^(forge|neoforge|fabric|quilt)-(.+)$/.exec(String(id ?? ''));
  if (!match) return {};
  const key = { forge: 'forge', neoforge: 'neoforge', fabric: 'fabric-loader', quilt: 'quilt-loader' }[match[1]];
  return { [key]: match[2] };
}

module.exports = {
  CURSEFORGE_DOWNLOAD_HOSTS,
  CLASS_FOLDERS,
  enabled,
  resolveFiles,
  fileSha1,
  filePageUrl,
  loaderDependency,
};
