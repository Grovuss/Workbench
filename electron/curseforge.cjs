const { CURSEFORGE_API_KEY, USER_AGENT } = require('./config.cjs');

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
      'User-Agent': USER_AGENT,
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

// ---------- Browsing (mods, resource packs, shaders) ----------

const GAME_ID = 432;
// classId per content kind, and back.
const KIND_CLASSES = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 };
const CLASS_KINDS = { 6: 'mod', 12: 'resourcepack', 6552: 'shader', 4471: 'modpack' };
// CurseForge's modLoaderType ids. Quilt can also run Fabric mods.
const LOADER_TYPES = { forge: [1], fabric: [4], quilt: [5, 4], neoforge: [6] };
const LOADER_NAMES = { forge: 'forge', fabric: 'fabric', quilt: 'quilt', neoforge: 'neoforge' };
// sortField: 2 popularity, 3 last updated, 6 total downloads, 11 released date. Relevance is CurseForge's default.
const SORT_FIELDS = { downloads: 6, follows: 2, newest: 11, updated: 3 };
const PAGE = 20;
// CurseForge stops paging at 10,000 results.
const MAX_INDEX = 10_000 - PAGE;

/** Project and version ids from CurseForge carry a prefix so they never get mixed up with Modrinth ids. */
const PREFIX = 'cf:';
const isCurseForgeId = (id) => typeof id === 'string' && id.startsWith(PREFIX);
const numericId = (id) => {
  const n = Number(String(id).slice(PREFIX.length));
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Unknown CurseForge project.');
  return n;
};

async function cfRaw(pathname) {
  if (!enabled()) throw new Error('CurseForge isn’t available in this copy of Workbench.');
  const res = await fetch(CF_API + pathname, {
    headers: { 'x-api-key': CURSEFORGE_API_KEY, Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`CurseForge request failed (${res.status}).`);
  return res.json();
}

function toHit(m) {
  return {
    projectId: PREFIX + m.id,
    slug: m.slug,
    kind: CLASS_KINDS[m.classId] ?? 'mod',
    title: m.name,
    description: m.summary ?? '',
    author: m.authors?.[0]?.name ?? '',
    iconUrl: m.logo?.thumbnailUrl || m.logo?.url || null,
    downloads: m.downloadCount ?? 0,
    follows: m.thumbsUpCount ?? 0,
    updatedAt: m.dateModified ?? m.dateReleased,
    source: 'curseforge',
  };
}

// Modrinth category names whose CurseForge equivalent is named differently.
const CATEGORY_ALIASES = {
  optimization: 'performance',
  adventure: 'adventure-rpg',
  decoration: 'cosmetic',
  equipment: 'armor-weapons-tools',
  food: 'mc-food',
  library: 'library-api',
  mobs: 'world-mobs',
  transportation: 'technology-player-transport',
  utility: 'utility-qol',
  worldgen: 'world-gen',
  realistic: 'photo-realistic',
  '16x': 'sixteen-x',
  '32x': 'thirty-two-x',
  '64x': 'sixty-four-x',
  '128x': 'one-twenty-eight-x',
  '256x': 'two-fifty-six-x',
  '512x+': 'five-twelve-x-and-beyond',
};
// The same for modpack categories, which CurseForge names differently again.
const MODPACK_ALIASES = {
  adventure: 'adventure-and-rpg',
  technology: 'tech',
  combat: 'combat-pvp',
  challenging: 'hardcore',
  lightweight: 'small-light',
  'kitchen-sink': 'extra-large',
};

const categoryCache = new Map();
/** The CurseForge category matching a Modrinth category name ("game-mechanics"), if there is one. */
async function categoryId(kind, name) {
  const classId = KIND_CLASSES[kind];
  if (!classId || !name) return null;
  if (!categoryCache.has(classId)) categoryCache.set(classId, cf(`/categories?gameId=${GAME_ID}&classId=${classId}`).catch(() => []));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = [name, kind === 'modpack' ? MODPACK_ALIASES[name] : CATEGORY_ALIASES[name]].filter(Boolean).map(norm);
  const match = (await categoryCache.get(classId)).find((c) => wanted.includes(norm(c.slug)) || wanted.includes(norm(c.name)));
  return match?.id ?? null;
}

/**
 * One page of CurseForge results. `kinds` are the content kinds asked for; with a profile, results
 * are limited to its Minecraft version and (for mods) its loader. Returns null when CurseForge
 * can't answer this search (a category it doesn't have), so the caller shows Modrinth alone.
 */
async function search({ kinds, profile = null, gameVersion = null, loader = null, query = '', sort, category, index = 0 }) {
  // Without a profile, Browse can still narrow to a Minecraft version and loader.
  const mcVersion = profile?.mcVersion ?? gameVersion;
  const modLoader = profile?.loader ?? loader;
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    pageSize: String(PAGE),
    index: String(Math.min(index, MAX_INDEX)),
    sortOrder: 'desc',
  });
  if (query) params.set('searchFilter', String(query).slice(0, 200));
  if (SORT_FIELDS[sort]) params.set('sortField', String(SORT_FIELDS[sort]));
  // Several kinds can't be asked for at once: with a profile, "all" means its mods (the loader
  // filter would hide packs anyway); without one, everything is fetched and filtered here.
  const single = kinds.length === 1 ? kinds[0] : modLoader ? 'mod' : null;
  if (single) params.set('classId', String(KIND_CLASSES[single]));
  if (category) {
    if (!single) return null;
    const id = await categoryId(single, category);
    if (!id) return null;
    params.set('categoryId', String(id));
  }
  if (mcVersion) params.set('gameVersion', mcVersion);
  if (modLoader) {
    const types = single === 'mod' ? LOADER_TYPES[modLoader] : null;
    if (types) params.set('modLoaderTypes', JSON.stringify(types));
  }
  const body = await cfRaw(`/mods/search?${params}`);
  const allowed = new Set(single ? [single] : kinds);
  const hits = body.data.filter((m) => allowed.has(CLASS_KINDS[m.classId])).map(toHit);
  const total = Math.min(body.pagination?.totalCount ?? 0, 10_000);
  const next = index + body.data.length;
  return { hits, total, next: body.data.length === PAGE && next < total && next <= MAX_INDEX ? next : null };
}

/** Splits a file's gameVersions ("1.21.1", "NeoForge", "Client") into Minecraft versions and loaders. */
function fileTargets(file, kind) {
  const names = file.gameVersions ?? [];
  const gameVersions = names.filter((v) => /^\d+(\.\d+)+/.test(v));
  let loaders = names.map((v) => LOADER_NAMES[v.toLowerCase()]).filter(Boolean);
  // Packs don't name a loader; give them the ones Workbench uses for those kinds.
  if (kind === 'resourcepack') loaders = ['minecraft'];
  else if (kind === 'shader') loaders = ['iris', 'optifine'];
  return { gameVersions, loaders };
}

/** A CurseForge file in the shape of a Modrinth version, so installs and version lists treat both alike. */
function toVersion(file, kind) {
  const { gameVersions, loaders } = fileTargets(file, kind);
  return {
    id: PREFIX + file.id,
    project_id: PREFIX + file.modId,
    name: file.displayName,
    version_number: file.displayName,
    version_type: { 1: 'release', 2: 'beta', 3: 'alpha' }[file.releaseType] ?? 'release',
    date_published: file.fileDate,
    downloads: file.downloadCount ?? 0,
    game_versions: gameVersions,
    loaders,
    changelog: '',
    // Files whose author turned off third-party downloads have no URL, so nothing to install.
    files: file.downloadUrl
      ? [{ filename: file.fileName, url: file.downloadUrl, primary: true, size: file.fileLength, hashes: { sha1: fileSha1(file) } }]
      : [],
    // Modrinth-style dependencies stay empty; CurseForge's required ones are listed by project id.
    dependencies: [],
    requires: (file.dependencies ?? []).filter((d) => d.relationType === 3).map((d) => PREFIX + d.modId),
  };
}

/** A project's files, newest first; optionally only those for a Minecraft version and loader type. */
async function files(projectId, { gameVersion, loaderType } = {}, limit = 500) {
  const id = numericId(projectId);
  const out = [];
  for (let index = 0; index < limit; index += 50) {
    const params = new URLSearchParams({ index: String(index), pageSize: '50' });
    if (gameVersion) params.set('gameVersion', gameVersion);
    if (loaderType) params.set('modLoaderType', String(loaderType));
    const body = await cfRaw(`/mods/${id}/files?${params}`);
    out.push(...body.data);
    if (body.data.length < 50 || out.length >= (body.pagination?.totalCount ?? 0)) break;
  }
  return out.sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate));
}

const file = (projectId, versionId) => cf(`/mods/${numericId(projectId)}/files/${numericId(versionId)}`);
const project = (projectId) => cf(`/mods/${numericId(projectId)}`);
const kindOf = (m) => CLASS_KINDS[m.classId] ?? null;

/** The project page, in the shape the details view uses for Modrinth projects. */
async function details(projectId) {
  const id = numericId(projectId);
  const [m, body] = await Promise.all([cf(`/mods/${id}`), cf(`/mods/${id}/description`).catch(() => '')]);
  const link = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);
  const kind = kindOf(m) ?? 'mod';
  const loaderOf = (type) => Object.keys(LOADER_TYPES).find((k) => LOADER_TYPES[k][0] === type);
  const indexes = m.latestFilesIndexes ?? [];
  return {
    projectId: PREFIX + m.id,
    slug: m.slug,
    type: kind,
    title: m.name,
    description: m.summary ?? '',
    body: typeof body === 'string' ? body : '',
    author: m.authors?.[0]?.name ?? null,
    iconUrl: m.logo?.thumbnailUrl || null,
    downloads: m.downloadCount ?? 0,
    follows: m.thumbsUpCount ?? 0,
    publishedAt: m.dateCreated ?? m.dateReleased,
    updatedAt: m.dateModified,
    categories: (m.categories ?? []).map((c) => c.slug),
    loaders: kind === 'mod' ? [...new Set(indexes.map((f) => loaderOf(f.modLoader)).filter(Boolean))] : [],
    gameVersions: [...new Set(indexes.map((f) => f.gameVersion).filter(Boolean))],
    clientSide: 'unknown',
    serverSide: 'unknown',
    license: null,
    gallery: (m.screenshots ?? [])
      .filter((g) => link(g.url))
      .map((g) => ({ url: link(g.thumbnailUrl) ?? g.url, fullUrl: g.url, title: g.title || null, description: g.description || null })),
    links: {
      modrinth: link(m.links?.websiteUrl),
      source: link(m.links?.sourceUrl),
      issues: link(m.links?.issuesUrl),
      wiki: link(m.links?.wikiUrl),
      discord: null,
    },
    source: 'curseforge',
  };
}

/**
 * A project's files that work on a profile, as Modrinth-style versions, newest first. For mods,
 * only files for the profile's loader (Quilt also takes Fabric ones).
 */
async function candidates(projectId, kind, profile) {
  const types = kind === 'mod' ? (LOADER_TYPES[profile.loader] ?? []) : [null];
  const out = [];
  for (const loaderType of types) {
    for (const f of await files(projectId, { gameVersion: profile.mcVersion, loaderType }, 100)) {
      const v = toVersion(f, kind);
      if (v.game_versions.includes(profile.mcVersion) && !out.some((o) => o.id === v.id)) out.push(v);
    }
  }
  return out.sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published));
}

/** The newest that fits, preferring releases; null if nothing does. */
async function newestFor(projectId, kind, profile) {
  const list = await candidates(projectId, kind, profile);
  return list.find((v) => v.version_type === 'release') ?? list[0] ?? null;
}

/** A file's changelog (HTML, which the app's Markdown view understands); '' when there isn't one. */
async function changelog(projectId, versionId) {
  const text = await cf(`/mods/${numericId(projectId)}/files/${numericId(versionId)}/changelog`).catch(() => '');
  return typeof text === 'string' ? text : '';
}

// ---------- Modpacks ----------

const loaderOfType = (type) => Object.keys(LOADER_TYPES).find((k) => LOADER_TYPES[k][0] === type) ?? null;

/** One page of CurseForge modpacks, in the shape the modpack browser uses; null when a filter can't apply. */
async function searchModpacks({ query = '', sort, category, loader, gameVersion, index = 0 }) {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(KIND_CLASSES.modpack),
    pageSize: String(PAGE),
    index: String(Math.min(index, MAX_INDEX)),
    sortOrder: 'desc',
  });
  if (query) params.set('searchFilter', String(query).slice(0, 200));
  if (SORT_FIELDS[sort]) params.set('sortField', String(SORT_FIELDS[sort]));
  if (gameVersion) params.set('gameVersion', String(gameVersion));
  if (LOADER_TYPES[loader]) params.set('modLoaderType', String(LOADER_TYPES[loader][0]));
  if (category) {
    const id = await categoryId('modpack', category);
    if (!id) return null;
    params.set('categoryId', String(id));
  }
  const body = await cfRaw(`/mods/search?${params}`);
  const hits = body.data.map((m) => {
    const indexes = m.latestFilesIndexes ?? [];
    return {
      projectId: PREFIX + m.id,
      title: m.name,
      description: m.summary ?? '',
      author: m.authors?.[0]?.name ?? '',
      iconUrl: m.logo?.thumbnailUrl || null,
      downloads: m.downloadCount ?? 0,
      follows: m.thumbsUpCount ?? 0,
      updatedAt: m.dateModified ?? m.dateReleased,
      loaders: [...new Set(indexes.map((i) => loaderOfType(i.modLoader)).filter(Boolean))],
      gameVersions: [...new Set(indexes.map((i) => i.gameVersion).filter(Boolean))],
      source: 'curseforge',
    };
  });
  const total = Math.min(body.pagination?.totalCount ?? 0, 10_000);
  const next = index + body.data.length;
  return { hits, total, next: body.data.length === PAGE && next < total && next <= MAX_INDEX ? next : null };
}

module.exports = {
  CURSEFORGE_DOWNLOAD_HOSTS,
  CLASS_FOLDERS,
  LOADER_TYPES,
  enabled,
  resolveFiles,
  fileSha1,
  filePageUrl,
  loaderDependency,
  isCurseForgeId,
  numericId,
  candidates,
  newestFor,
  changelog,
  searchModpacks,
  search,
  files,
  file,
  toVersion,
  project,
  kindOf,
  details,
};
