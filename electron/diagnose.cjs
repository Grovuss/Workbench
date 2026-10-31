const fsp = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');
const profiles = require('./profiles.cjs');
const content = require('./content.cjs');

// Finds mod problems before they crash the game (by reading each jar's own metadata),
// and explains crashes afterwards (by reading the log and crash report).
//
// A problem is { id, message, files, fixes }, where each fix is one of
//   { type: 'disable', fileName, label }   turn a mod off
//   { type: 'install', modId, label }      install a missing mod from Modrinth
//   { type: 'settings', label }            something to change in the profile's settings

// ---------- Versions ----------

/** "1.20.1", "0.5.8+mc1.20.1", "1.21-pre1" → { nums, pre }; null for anything else (snapshots, "mc1.20-1.0"). */
function parseVersion(str) {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]*))?(?:\+.*)?$/.exec(String(str ?? '').trim());
  return m ? { nums: m[1].split('.').map(Number), pre: m[2] ?? null } : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  // "1.21-" (empty pre-release) means "the earliest 1.21 pre-release".
  if (a.pre === '') return -1;
  if (b.pre === '') return 1;
  const pa = a.pre.split('.');
  const pb = b.pre.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    const d = Number.isNaN(na) || Number.isNaN(nb) ? pa[i].localeCompare(pb[i]) : na - nb;
    if (d) return Math.sign(d);
  }
  return 0;
}

// Version checks answer true, false, or null when the range or version can't be read.
// Problems are only reported on a definite false, so odd version schemes never cause false alarms.

/** One Fabric predicate: "*", ">=1.20 <1.21", "~1.20.1", "^0.5", "1.20.x", "1.20.1". */
function fabricSingle(predicate, version) {
  const parts = predicate.trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts.includes('*')) return true;
  const v = parseVersion(version);
  if (!v) return null;
  for (const part of parts) {
    const [, op = '', raw] = /^(>=|<=|>|<|=|~|\^)?(.*)$/.exec(part);
    const segments = raw.split('.');
    const wildcard = segments.findIndex((s) => /^[xX*]$/.test(s));
    if (wildcard !== -1) {
      const prefix = segments.slice(0, wildcard).map(Number);
      if ((op && op !== '=') || prefix.some(Number.isNaN)) return null;
      if (!prefix.every((n, i) => (v.nums[i] ?? 0) === n)) return false;
      continue;
    }
    const t = parseVersion(raw);
    if (!t) return null;
    const c = compareVersions(v, t);
    const ok = {
      '>=': c >= 0,
      '<=': c <= 0,
      '>': c > 0,
      '<': c < 0,
      '=': c === 0,
      '': c === 0,
      '~': c >= 0 && v.nums[0] === t.nums[0] && (v.nums[1] ?? 0) === (t.nums[1] ?? 0),
      '^': c >= 0 && v.nums[0] === t.nums[0],
    }[op];
    if (!ok) return false;
  }
  return true;
}

/** Fabric dependency value: a predicate or a list of alternatives. */
function fabricMatches(predicate, version) {
  const alternatives = Array.isArray(predicate) ? predicate : [predicate];
  if (!alternatives.length) return true;
  let unknown = false;
  for (const p of alternatives) {
    const r = typeof p === 'string' ? fabricSingle(p, version) : null;
    if (r === true) return true;
    if (r === null) unknown = true;
  }
  return unknown ? null : false;
}

/** Forge/Maven range: "[1.20.1,1.21)", "[47,)", "[1.0,1.2),(1.3,)". A bare version means "any". */
function mavenMatches(range, version) {
  const text = String(range ?? '').trim();
  if (!text || text === '*') return true;
  if (text.includes('${')) return null;
  if (!/^[[(]/.test(text)) return true;
  const v = parseVersion(version);
  const sets = text.match(/[[(][^\])]*[\])]/g);
  if (!v || !sets) return null;
  let unknown = false;
  for (const set of sets) {
    const inner = set.slice(1, -1);
    const [lo, hi] = inner.includes(',') ? inner.split(',').map((s) => s.trim()) : [inner.trim(), inner.trim()];
    const low = lo ? parseVersion(lo) : null;
    const high = hi ? parseVersion(hi) : null;
    if ((lo && !low) || (hi && !high)) {
      unknown = true;
      continue;
    }
    const aboveLow = !low || (set[0] === '[' ? compareVersions(v, low) >= 0 : compareVersions(v, low) > 0);
    const belowHigh = !high || (set.at(-1) === ']' ? compareVersions(v, high) <= 0 : compareVersions(v, high) < 0);
    if (aboveLow && belowHigh) return true;
  }
  return unknown ? null : false;
}

/** One Fabric predicate in words: ">=0.15" → "0.15 or newer", ">=1.20 <1.21" → "1.20 up to 1.21". */
function describeFabric(predicate) {
  const parts = predicate.trim().split(/\s+/).map((p) => p.replace(/-$/, ''));
  if (parts.length === 2 && parts[0].startsWith('>=') && /^<[^=]/.test(parts[1])) return `${parts[0].slice(2)} up to ${parts[1].slice(1)}`;
  return parts
    .map((part) => {
      const [, op = '', v] = /^(>=|<=|>|<|=|~|\^)?(.*)$/.exec(part);
      switch (op) {
        case '>=':
        case '^':
          return `${v} or newer`;
        case '<=':
          return `${v} or older`;
        case '>':
          return `newer than ${v}`;
        case '<':
          return `older than ${v}`;
        case '~':
          return `${v.split('.').slice(0, 2).join('.')}.x`;
        default:
          return v;
      }
    })
    .join(' and ');
}

/** A version range in words, for messages. */
function describeRange(range) {
  if (Array.isArray(range)) return range.map(describeFabric).join(' or ');
  const text = String(range ?? '').trim();
  const m = /^\[([^,\]]*),([^)\]]*)([)\]])$/.exec(text);
  if (m) {
    if (!m[2]) return `${m[1]} or newer`;
    return m[3] === ')' ? `${m[1]} up to ${m[2]}` : `${m[1]} to ${m[2]}`;
  }
  return /^[[(]/.test(text) ? text : describeFabric(text);
}

// ---------- Reading mod metadata ----------

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Some mods put raw newlines or tabs inside strings.
    try {
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return null;
    }
  }
}

/** Just enough TOML for mods.toml: [[mods]], [[dependencies.<id>]], and key = value lines. */
function parseModsToml(text) {
  const mods = [];
  const deps = {};
  let current = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    let m = /^\[\[\s*([^\]]+?)\s*\]\]/.exec(line);
    if (m) {
      current = {};
      if (m[1] === 'mods') mods.push(current);
      else if (m[1].startsWith('dependencies.')) (deps[m[1].slice(13).replace(/^"|"$/g, '')] ??= []).push(current);
      continue;
    }
    if (line.startsWith('[')) {
      current = null; // a table we don't use
      continue;
    }
    m = /^"?([\w.-]+)"?\s*=\s*(.*)$/.exec(line);
    if (!m || !current) continue;
    const raw = m[2];
    let value;
    const triple = /^('''|""")/.exec(raw);
    if (triple) {
      let body = raw.slice(3);
      while (!body.includes(triple[1]) && i + 1 < lines.length) body += `\n${lines[++i]}`;
      value = body.slice(0, body.indexOf(triple[1]));
    } else if (raw.startsWith('"')) {
      value = (/^"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1] ?? '').replace(/\\(.)/g, '$1');
    } else if (raw.startsWith("'")) {
      value = /^'([^']*)'/.exec(raw)?.[1] ?? '';
    } else {
      const bare = raw.replace(/\s+#.*$/, '').trim();
      value = bare === 'true' ? true : bare === 'false' ? false : bare;
    }
    current[m[1]] = value;
  }
  return { mods, deps };
}

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Quilt dependency lists: ["id", { id, versions, optional }] → { id: range }. */
function quiltDeps(list) {
  const out = {};
  for (const d of Array.isArray(list) ? list : []) {
    if (typeof d === 'string') out[d] = '*';
    else if (d?.id && !d.optional && !d.unless) out[d.id] = typeof d.versions === 'string' || Array.isArray(d.versions) ? d.versions : '*';
  }
  return out;
}

function manifestVersion(zip) {
  const text = zip.getEntry('META-INF/MANIFEST.MF')?.getData().toString('utf8') ?? '';
  return /^Implementation-Version:\s*(.+)$/m.exec(text)?.[1].trim() ?? null;
}

/**
 * Everything a jar says about itself, per platform:
 * { fabric?, quilt?, forge?, neoforge? } where each is { mods: [...], nested: [paths] }.
 * Mods: { id, name, version, depends: { id: range }, breaks: { id: range }, provides: [id], syntax: 'fabric' | 'maven' }.
 */
function readJarMeta(zip) {
  const text = (name) => zip.getEntry(name)?.getData().toString('utf8') ?? null;
  const meta = {};

  const fabric = parseJsonLoose(text('fabric.mod.json') ?? 'null');
  if (fabric?.id) {
    meta.fabric = {
      mods: [
        {
          id: fabric.id,
          name: fabric.name || fabric.id,
          version: String(fabric.version ?? ''),
          depends: asObject(fabric.depends),
          breaks: asObject(fabric.breaks),
          provides: Array.isArray(fabric.provides) ? fabric.provides.map(String) : [],
          syntax: 'fabric',
        },
      ],
      nested: (fabric.jars ?? []).map((j) => j?.file).filter(Boolean),
    };
  }

  const quilt = parseJsonLoose(text('quilt.mod.json') ?? 'null')?.quilt_loader;
  if (quilt?.id) {
    meta.quilt = {
      mods: [
        {
          id: quilt.id,
          name: quilt.metadata?.name || quilt.id,
          version: String(quilt.version ?? ''),
          depends: quiltDeps(quilt.depends),
          breaks: quiltDeps(quilt.breaks),
          provides: (quilt.provides ?? []).map((p) => (typeof p === 'string' ? p : p?.id)).filter(Boolean),
          syntax: 'fabric',
        },
      ],
      nested: (quilt.jars ?? []).map((j) => (typeof j === 'string' ? j : j?.file)).filter(Boolean),
    };
  }

  const jarjar = parseJsonLoose(text('META-INF/jarjar/metadata.json') ?? 'null');
  const forgeNested = (jarjar?.jars ?? []).map((j) => j?.path).filter(Boolean);
  for (const [file, platform] of [
    ['META-INF/neoforge.mods.toml', 'neoforge'],
    ['META-INF/mods.toml', 'forge'],
  ]) {
    const toml = text(file);
    if (!toml) continue;
    const { mods, deps } = parseModsToml(toml);
    const jarVersion = manifestVersion(zip);
    meta[platform] = {
      mods: mods
        .filter((m) => typeof m.modId === 'string')
        .map((m) => {
          const depends = {};
          const breaks = {};
          for (const d of deps[m.modId] ?? []) {
            if (typeof d.modId !== 'string' || String(d.side ?? 'BOTH').toUpperCase() === 'SERVER') continue;
            const type = typeof d.type === 'string' ? d.type.toLowerCase() : d.mandatory === false ? 'optional' : 'required';
            if (type === 'required') depends[d.modId] = d.versionRange ?? '';
            else if (type === 'incompatible') breaks[d.modId] = d.versionRange ?? '';
          }
          const version = String(m.version ?? '');
          return {
            id: m.modId,
            name: m.displayName || m.modId,
            version: version.includes('${file.jarVersion}') ? (jarVersion ?? '') : version,
            depends,
            breaks,
            provides: [],
            syntax: 'maven',
          };
        }),
      nested: forgeNested,
    };
  }

  // Forge 1.12 and older.
  const mcmod = parseJsonLoose(text('mcmod.info') ?? 'null');
  const legacy = Array.isArray(mcmod) ? mcmod : mcmod?.modList;
  if (!meta.forge && Array.isArray(legacy)) {
    meta.forge = {
      mods: legacy
        .filter((m) => m?.modid)
        .map((m) => ({ id: m.modid, name: m.name || m.modid, version: String(m.version ?? ''), depends: {}, breaks: {}, provides: [], syntax: 'maven' })),
      nested: [],
    };
  }
  return meta;
}

/** Metadata the profile's loader will actually read, or null if the jar isn't for it. */
function metaFor(meta, loader) {
  switch (loader) {
    case 'fabric':
      return meta.fabric ?? null;
    case 'quilt':
      return meta.quilt ?? meta.fabric ?? null;
    case 'forge':
      return meta.forge ?? null;
    case 'neoforge':
      return meta.neoforge ?? meta.forge ?? null;
    default:
      return null;
  }
}

/** Ids (and versions) provided by jars bundled inside a jar, a couple of levels deep. */
function nestedProvides(zip, paths, loader, depth = 0, out = []) {
  if (depth > 2) return out;
  for (const p of paths) {
    const data = zip.getEntry(p)?.getData();
    if (!data) continue;
    let inner;
    try {
      inner = new AdmZip(data);
    } catch {
      continue;
    }
    const meta = metaFor(readJarMeta(inner), loader);
    if (!meta) continue;
    for (const mod of meta.mods) {
      out.push({ id: mod.id, version: mod.version });
      for (const id of mod.provides) out.push({ id, version: mod.version });
    }
    nestedProvides(inner, meta.nested, loader, depth + 1, out);
  }
  return out;
}

// Parsing jars is slow for big packs; remember results until the file changes.
const jarCache = new Map();

async function readJar(file) {
  const stat = await fsp.stat(file);
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (jarCache.has(key)) return jarCache.get(key);
  let result;
  try {
    const zip = new AdmZip(file);
    const meta = readJarMeta(zip);
    result = { meta, nested: {} };
    for (const loader of ['fabric', 'quilt', 'forge', 'neoforge']) {
      const m = metaFor(meta, loader);
      if (m?.nested.length) result.nested[loader] = nestedProvides(zip, m.nested, loader);
    }
  } catch {
    result = { meta: {}, nested: {} };
  }
  jarCache.set(key, result);
  return result;
}

// ---------- Checking a profile's mods ----------

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
// What mods depend on: the loader itself.
const LOADER_PRODUCTS = { fabric: 'Fabric Loader', quilt: 'Quilt Loader', forge: 'Forge', neoforge: 'NeoForge' };

/** Ids the loader itself provides, with their versions. */
function builtins(profile) {
  const ids = new Map([
    ['minecraft', profile.mcVersion],
    ['java', null],
  ]);
  const loaderVersion = profile.loaderVersion ?? null;
  switch (profile.loader) {
    case 'fabric':
      ids.set('fabricloader', loaderVersion).set('fabric-loader', loaderVersion).set('mixinextras', null);
      break;
    case 'quilt':
      ids.set('quilt_loader', loaderVersion).set('fabricloader', null).set('mixinextras', null);
      break;
    case 'forge':
      // Forge versions look like "1.20.1-47.3.0"; mods ask for "[47,)".
      ids.set('forge', loaderVersion?.replace(/^[^-]+-/, '').replace(/-.*$/, '') ?? null);
      for (const id of ['javafml', 'lowcodefml', 'mclanguage', 'fml']) ids.set(id, null);
      break;
    case 'neoforge':
      ids.set('neoforge', loaderVersion);
      for (const id of ['javafml', 'lowcodefml', 'mclanguage', 'fml']) ids.set(id, null);
      // NeoForge for 1.20.1 is a Forge fork and still answers to "forge".
      if (profile.mcVersion === '1.20.1') ids.set('forge', loaderVersion);
      break;
  }
  return ids;
}

const LOADER_IDS = new Set(['fabricloader', 'fabric-loader', 'quilt_loader', 'forge', 'neoforge']);
const LOADER_ID_NAMES = { fabricloader: 'Fabric Loader', 'fabric-loader': 'Fabric Loader', quilt_loader: 'Quilt Loader', forge: 'Forge', neoforge: 'NeoForge' };

/** "fabric-api" → "Fabric API", "cloth_config" → "Cloth Config". */
const prettyId = (id) =>
  id
    .split(/[-_]/)
    .map((w) => (w === 'api' ? 'API' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

const matches = (syntax, range, version) =>
  version == null ? null : syntax === 'fabric' ? fabricMatches(range, version) : mavenMatches(range, version);

/** "0.6.1+mc1.21.1" → "0.6.1", for messages. */
const shortVersion = (v) => String(v).replace(/\+.*$/, '');

const isAny = (range) => range === '*' || range === '' || range == null || (Array.isArray(range) && range.includes('*'));

// Mods that are known not to work together but don't say so in their own metadata. Any mod
// in `a` clashes with any mod in `b`; `range` limits it to those versions of the `b` mod.
const RENDERERS = ['embeddium', 'rubidium', 'magnesium', 'vulkanmod', 'canvas'];
const KNOWN_CONFLICTS = [
  { a: ['sodium'], b: RENDERERS, why: 'both replace Minecraft’s renderer' },
  { a: ['embeddium'], b: ['rubidium', 'magnesium', 'vulkanmod', 'canvas'], why: 'both replace Minecraft’s renderer' },
  { a: ['iris'], b: ['oculus', 'canvas', 'vulkanmod'], why: 'both change how shaders load' },
  {
    a: ['sodium', 'iris', 'embeddium', 'rubidium', 'oculus'],
    b: ['optifabric', 'optifine'],
    message: (a, b) => `${b.name} brings in OptiFine, which changes the same parts of the game as ${a.name}, so they can’t be used together.`,
  },
  { a: ['lithium'], b: ['canary', 'radium'], why: 'are versions of the same mod' },
  { a: ['phosphor'], b: ['starlight'], why: 'both replace the lighting engine' },
  {
    a: ['indium'],
    b: ['sodium'],
    range: '>=0.6.0-',
    message: (a, b) => `${a.name} isn’t needed with ${b.name} ${shortVersion(b.version)}, which does its job itself, and the two clash.`,
    disable: 'a',
  },
];

/** Problems with a profile's enabled mods, found by reading their metadata. */
async function scanMods(profileId) {
  const profile = await profiles.get(profileId);
  const { loader } = profile;
  if (loader === 'vanilla') return [];
  const dir = content.modsDir(profileId);
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const jars = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue;
    jars.push({ fileName: entry.name, ...(await readJar(path.join(dir, entry.name))) });
  }

  const problems = [];
  const add = (problem) => {
    if (!problems.some((p) => p.id === problem.id || p.message === problem.message)) problems.push(problem);
  };
  const disable = (fileName, name) => ({ type: 'disable', fileName, label: `Disable ${name}` });

  const provided = builtins(profile);
  const owners = new Map(); // mod id → jars that are that mod
  const mods = [];
  const hasConnector = jars.some((j) => j.meta.neoforge?.mods.some((m) => m.id === 'connector') || j.meta.forge?.mods.some((m) => m.id === 'connector'));

  for (const jar of jars) {
    const meta = metaFor(jar.meta, loader);
    const platforms = Object.keys(jar.meta);
    const displayName = meta?.mods[0]?.name ?? Object.values(jar.meta)[0]?.mods[0]?.name ?? jar.fileName;

    if (!meta) {
      // No metadata at all: a library or something we can't read. Leave it alone.
      if (!platforms.length) continue;
      const fabricOnly = platforms.every((p) => p === 'fabric' || p === 'quilt');
      if (fabricOnly && hasConnector) continue;
      const madeFor = LOADER_NAMES[platforms.includes('neoforge') && !platforms.includes('forge') ? 'neoforge' : platforms[0]];
      add({
        id: `loader:${jar.fileName}`,
        message: `${displayName} is a ${madeFor} mod, so it won’t load on ${LOADER_NAMES[loader]}.`,
        files: [jar.fileName],
        fixes: [disable(jar.fileName, displayName)],
      });
      continue;
    }

    // NeoForge 1.20.2+ can't load mods built for Forge.
    if (loader === 'neoforge' && !jar.meta.neoforge && profile.mcVersion !== '1.20.1') {
      const forgeMod = meta.mods.find((m) => 'forge' in m.depends);
      if (forgeMod) {
        add({
          id: `loader:${jar.fileName}`,
          message: `${forgeMod.name} is a Forge mod, so it won’t load on NeoForge.`,
          files: [jar.fileName],
          fixes: [disable(jar.fileName, forgeMod.name)],
        });
        continue;
      }
    }

    for (const mod of meta.mods) {
      mods.push({ ...mod, fileName: jar.fileName });
      if (!owners.has(mod.id)) owners.set(mod.id, []);
      owners.get(mod.id).push({ fileName: jar.fileName, version: mod.version, name: mod.name });
      if (!provided.has(mod.id)) provided.set(mod.id, mod.version);
      for (const id of mod.provides) if (!provided.has(id)) provided.set(id, mod.version);
    }
    for (const n of jar.nested[loader] ?? []) if (!provided.has(n.id)) provided.set(n.id, n.version);
  }

  // The same mod in two files.
  for (const [id, copies] of owners) {
    const files = [...new Set(copies.map((c) => c.fileName))];
    if (files.length < 2) continue;
    add({
      id: `duplicate:${id}`,
      message: `${copies[0].name} is installed ${files.length === 2 ? 'twice' : `${files.length} times`}: ${files.join(', ')}.`,
      files,
      fixes: files.map((f) => ({ type: 'disable', fileName: f, label: `Disable ${f}` })),
    });
  }

  for (const mod of mods) {
    for (const [depId, range] of Object.entries(mod.depends)) {
      if (depId === 'java') continue;

      if (depId === 'minecraft') {
        if (matches(mod.syntax, range, profile.mcVersion) === false) {
          add({
            id: `minecraft:${mod.fileName}`,
            message: `${mod.name} is made for Minecraft ${describeRange(range)}, not ${profile.mcVersion}.`,
            files: [mod.fileName],
            fixes: [disable(mod.fileName, mod.name)],
          });
        }
        continue;
      }

      if (LOADER_IDS.has(depId)) {
        if (!provided.has(depId)) continue; // a Forge mod asking for "forge" on NeoForge is handled above
        if (!isAny(range) && matches(mod.syntax, range, provided.get(depId)) === false) {
          add({
            id: `loaderversion:${mod.fileName}`,
            message: `${mod.name} needs ${LOADER_PRODUCTS[profile.loader]} ${describeRange(range)}, but this profile uses ${provided.get(depId)}.`,
            files: [mod.fileName],
            fixes: [{ type: 'settings', label: 'Change loader version' }, disable(mod.fileName, mod.name)],
          });
        }
        continue;
      }

      if (!provided.has(depId)) {
        const depName = prettyId(depId);
        add({
          id: `missing:${mod.fileName}:${depId}`,
          message: `${mod.name} needs ${depName}, which isn’t installed.`,
          files: [mod.fileName],
          fixes: [{ type: 'install', modId: depId, label: `Install ${depName}` }, disable(mod.fileName, mod.name)],
        });
        continue;
      }

      // Only Fabric/Quilt version numbers are consistent enough to compare between mods.
      const have = provided.get(depId);
      if (mod.syntax === 'fabric' && !isAny(range) && fabricMatches(range, have) === false) {
        const depName = owners.get(depId)?.[0]?.name ?? prettyId(depId);
        add({
          id: `version:${mod.fileName}:${depId}`,
          message: `${mod.name} needs ${depName} ${describeRange(range)}, but ${shortVersion(have)} is installed.`,
          files: [mod.fileName, ...(owners.get(depId)?.map((o) => o.fileName) ?? [])],
          fixes: [disable(mod.fileName, mod.name)],
        });
      }
    }

    for (const [otherId, range] of Object.entries(mod.breaks)) {
      const others = owners.get(otherId);
      if (!others || otherId === mod.id) continue;
      const other = others[0];
      const anyVersion = isAny(range);
      if (!anyVersion && matches(mod.syntax, range, other.version) !== true) continue;
      add({
        id: `breaks:${[mod.fileName, other.fileName].sort().join(':')}`,
        message: anyVersion
          ? `${mod.name} doesn’t work alongside ${other.name}.`
          : `${mod.name} doesn’t work with ${other.name} ${describeRange(range)}, and ${shortVersion(other.version)} is installed. Try another version of either.`,
        files: [mod.fileName, other.fileName],
        fixes: [disable(mod.fileName, mod.name), disable(other.fileName, other.name)],
      });
    }
  }

  for (const rule of KNOWN_CONFLICTS) {
    for (const aId of rule.a) {
      const a = owners.get(aId)?.[0];
      if (!a) continue;
      for (const bId of rule.b) {
        const b = owners.get(bId)?.[0];
        if (!b || a.fileName === b.fileName) continue;
        if (rule.range && fabricMatches(rule.range, b.version) !== true) continue;
        add({
          // Same id as a declared "breaks", so a clash is only listed once.
          id: `breaks:${[a.fileName, b.fileName].sort().join(':')}`,
          message: rule.message ? rule.message(a, b) : `${a.name} and ${b.name} ${rule.why}, so they can’t be used together.`,
          files: [a.fileName, b.fileName],
          fixes: rule.disable === 'a' ? [disable(a.fileName, a.name)] : [disable(b.fileName, b.name), disable(a.fileName, a.name)],
        });
      }
    }
  }

  return problems;
}

/** Mod id → enabled jar that provides it, for pointing at the file behind a crash. */
async function modFiles(profileId, loader) {
  const dir = content.modsDir(profileId);
  const entries = await fsp.readdir(dir).catch(() => []);
  const byId = new Map();
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.jar')) continue;
    const { meta } = await readJar(path.join(dir, name));
    for (const mod of metaFor(meta, loader)?.mods ?? []) byId.set(mod.id, { fileName: name, name: mod.name });
  }
  return byId;
}

// ---------- After a crash ----------

const MODRINTH_SLUGS = {
  fabric: 'fabric-api',
  'fabric-api': 'fabric-api',
  'cloth-config': 'cloth-config',
  'cloth-config2': 'cloth-config',
  cloth_config: 'cloth-config',
  architectury: 'architectury-api',
  yet_another_config_lib_v3: 'yacl',
  yet_another_config_lib: 'yacl',
  kotlinforforge: 'kotlin-for-forge',
  forgeconfigapiport: 'forge-config-api-port',
  puzzleslib: 'puzzles-lib',
  owo: 'owo-lib',
  resourcefullib: 'resourceful-lib',
  bookshelf: 'bookshelf-lib',
  fzzy_config: 'fzzy-config',
  supermartijn642corelib: 'supermartijn642s-core-lib',
  cristellib: 'cristel-lib',
  roughlyenoughitems: 'rei',
  geckolib: 'geckolib',
};

/** Modrinth slugs worth trying for a mod id, best guess first. */
function slugCandidates(modId) {
  if (MODRINTH_SLUGS[modId]) return [MODRINTH_SLUGS[modId]];
  // Fabric API's modules ("fabric-networking-api-v1") all come with Fabric API.
  if (/^fabric-.+(-api|-v\d+)$/.test(modId) || modId === 'fabric-api-base') return ['fabric-api'];
  return [...new Set([modId, modId.replace(/_/g, '-')])];
}

/** Installs a missing dependency from Modrinth, looked up by its mod id. */
async function installDependency(profileId, modId) {
  for (const slug of slugCandidates(String(modId))) {
    const project = await content.modrinth(`/project/${encodeURIComponent(slug)}`).catch(() => null);
    if (project?.project_type === 'mod') return content.install({ profileId, kind: 'mod' }, project.id);
  }
  throw new Error(`Couldn’t find ${prettyId(String(modId))} on Modrinth. Search for it in Browse content.`);
}

const CRASH_REPORT_BYTES = 256 * 1024;

async function newestCrashReport(profileId, since) {
  const dir = path.join(profiles.gameDir(profileId), 'crash-reports');
  const names = await fsp.readdir(dir).catch(() => []);
  let newest = null;
  for (const name of names) {
    if (!name.endsWith('.txt')) continue;
    const { mtimeMs } = await fsp.stat(path.join(dir, name));
    if (mtimeMs >= since && (!newest || mtimeMs > newest.mtimeMs)) newest = { name, mtimeMs };
  }
  if (!newest) return null;
  const handle = await fsp.open(path.join(dir, newest.name));
  try {
    const buf = Buffer.alloc(Math.min(CRASH_REPORT_BYTES, (await handle.stat()).size));
    await handle.read(buf, 0, buf.length, 0);
    return { name: newest.name, text: buf.toString('utf8') };
  } finally {
    await handle.close();
  }
}

// Class file version → Java release, for "compiled by a more recent version" errors.
const CLASS_JAVA = { 52: 8, 55: 11, 60: 16, 61: 17, 65: 21, 66: 22, 67: 23, 68: 24, 69: 25 };

/**
 * Explains why the game stopped. Returns { exitCode, problems, crashReport } or null when
 * the game exited normally and the log shows nothing wrong.
 */
async function analyzeCrash(profileId, startedAt, exitCode) {
  const profile = await profiles.get(profileId);
  // Only the part of the log from this launch.
  const log = (await profiles.readLog(profileId)) ?? '';
  const report = await newestCrashReport(profileId, startedAt - 1000);
  const text = `${log}\n${report?.text ?? ''}`;
  const problems = [];
  const add = (p) => {
    if (!problems.some((x) => x.id === p.id)) problems.push(p);
  };
  let files = null;
  const fileFor = async (modId) => (files ??= await modFiles(profileId, profile.loader)).get(modId) ?? null;
  const disableFix = async (modId) => {
    const f = await fileFor(modId);
    return f ? [{ type: 'disable', fileName: f.fileName, label: `Disable ${f.name}` }] : [];
  };

  // Fabric: " - Mod 'Sodium Extra' (sodium-extra) 0.5.1 requires version 0.5.0 or later of mod 'Sodium' (sodium), which is missing!"
  for (const m of text.matchAll(/^\s*- Mod '(.+?)' \(([\w.-]+)\) \S+ (.*?)$/gm)) {
    const [, ownerName, owner] = m;
    const rest = m[3].replace(/\s+/g, ' ').trim().replace(/!$/, '');
    // "requires version 0.5.0 or later of mod 'Sodium' (sodium), which is missing" / "requires any version of owo-lib, which is missing"
    const missing = /^requires (?:(.+?) of|any version of) (?:mod )?(?:'([^']+)' \(([\w.-]+)\)|([\w.-]+)), which is missing$/.exec(rest);
    const fixes = [];
    let message;
    if (missing) {
      const depId = missing[3] ?? missing[4];
      const depName = missing[2] ?? prettyId(depId);
      const version = missing[1] && !/^any version$/.test(missing[1]) ? ` ${missing[1].replace(/^version /, '')}` : '';
      message = `${ownerName} needs ${depName}${version}, which isn’t installed.`;
      fixes.push({ type: 'install', modId: depId, label: `Install ${depName}` });
    } else {
      message = `${ownerName} ${rest}.`;
    }
    fixes.push(...(await disableFix(owner)));
    add({ id: `fabric:${owner}:${rest}`, message, files: fixes.filter((f) => f.fileName).map((f) => f.fileName), fixes });
  }

  // Forge: "Mod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range: '[4.4,)', Actual version: '[MISSING]'"
  for (const m of text.matchAll(/Mod ID: '([\w.-]+)', Requested by: '([\w.-]+)', Expected range: '([^']*)', Actual version: '([^']*)'/g)) {
    const [, depId, owner, range, actual] = m;
    const ownerName = (await fileFor(owner))?.name ?? prettyId(owner);
    const depName = (await fileFor(depId))?.name ?? (LOADER_ID_NAMES[depId] ?? prettyId(depId));
    const fixes = [];
    if (actual === '[MISSING]') fixes.push({ type: 'install', modId: depId, label: `Install ${depName}` });
    else if (LOADER_IDS.has(depId)) fixes.push({ type: 'settings', label: 'Change loader version' });
    fixes.push(...(await disableFix(owner)));
    add({
      id: `forge:${owner}:${depId}`,
      message:
        actual === '[MISSING]'
          ? `${ownerName} needs ${depName}, which isn’t installed.`
          : `${ownerName} needs ${depName} ${describeRange(range)}, but ${actual} is installed.`,
      files: fixes.filter((f) => f.fileName).map((f) => f.fileName),
      fixes,
    });
  }

  if (/java\.lang\.OutOfMemoryError|There is insufficient memory for the Java Runtime/.test(text)) {
    add({
      id: 'memory',
      message: 'Minecraft ran out of memory. Big modpacks usually need 6–8 GB.',
      files: [],
      fixes: [{ type: 'settings', label: 'Give it more memory' }],
    });
  }
  if (/Could not reserve enough space for object heap|Invalid maximum heap size|Initial heap size set to a larger value/.test(text)) {
    add({
      id: 'heap',
      message: 'Java couldn’t get the memory it was set to use. Lower the memory setting for this profile.',
      files: [],
      fixes: [{ type: 'settings', label: 'Change memory' }],
    });
  }

  const classVersion = /compiled by a more recent version of the Java Runtime \(class file version (\d+)/.exec(text);
  if (classVersion) {
    const java = CLASS_JAVA[Math.floor(Number(classVersion[1]))];
    add({
      id: 'java',
      message: `A mod needs Java ${java ?? 'a newer version'}, which is newer than this Minecraft version uses. It was probably made for a newer Minecraft version.`,
      files: [],
      fixes: [],
    });
  }

  // Mixin failures name the mod that broke.
  for (const m of text.matchAll(/Mixin (?:apply|prepare) for mod ([\w.-]+) failed|from mod ([\w.-]+)\]?(?: failed| ->)/g)) {
    const modId = m[1] ?? m[2];
    if (!modId || modId === 'minecraft') continue;
    const f = await fileFor(modId);
    add({
      id: `mixin:${modId}`,
      message: `${f?.name ?? prettyId(modId)} failed to load. It may not work with this Minecraft version or another mod.`,
      files: f ? [f.fileName] : [],
      fixes: await disableFix(modId),
    });
  }

  if (/Found (?:\d+ )?duplicate mods?|DuplicateModsFoundException|Duplicate mods found/i.test(text)) {
    add({ id: 'duplicates', message: 'Some mods are installed more than once.', files: [], fixes: [] });
  }

  // Fabric crash reports: "Suspected Mods: Sodium (sodium), Version: 0.5.8"
  const suspected = /Suspected Mods?:\s*([\s\S]*?)(?:\n\s*\n|Stacktrace:)/.exec(report?.text ?? '');
  if (suspected && !/Unknown|None/.test(suspected[1].split('\n')[0])) {
    for (const m of suspected[1].matchAll(/([^\n,]+?) \(([\w.-]+)\)/g)) {
      const [, name, modId] = m;
      if (['minecraft', 'java', 'fabricloader'].includes(modId)) continue;
      const fixes = await disableFix(modId);
      add({
        id: `suspect:${modId}`,
        message: `The crash report points at ${name.trim()}.`,
        files: fixes.map((f) => f.fileName),
        fixes,
      });
    }
  }

  if (/EXCEPTION_ACCESS_VIOLATION|A fatal error has been detected by the Java Runtime/.test(text) && !problems.length) {
    add({
      id: 'native',
      message: 'The game crashed outside of Java, which usually means a graphics driver problem. Updating your graphics drivers often fixes it.',
      files: [],
      fixes: [],
    });
  }

  // A crash with nothing specific in the log: mod conflicts we can see ahead of time are the best lead.
  if (exitCode && !problems.length) {
    for (const p of await scanMods(profileId).catch(() => [])) add(p);
  }

  if (!exitCode && !problems.length) return null;
  return { exitCode: exitCode ?? null, problems, crashReport: report?.name ?? null };
}

module.exports = {
  scanMods,
  analyzeCrash,
  installDependency,
};
